package nodecontroller

import (
	"context"
	"sync"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/logging"
)

const (
	coordinatorSafetyInterval = 5 * time.Second
	coordinatorMaintainEvery  = 10 * time.Second
	coordinatorNodeTimeout    = 2 * time.Minute
	coordinatorMaxParallel    = 16
	coordinatorEscalateAfter  = 3
	coordinatorMaxFailures    = 6
	coordinatorMaxBackoff     = 30 * time.Second
	coordinatorBatch          = 5000
)

type CoordinatorBackend interface {
	NodesWithOpenOperations(ctx context.Context) ([]int64, bool, error)
	ProcessNode(ctx context.Context, nodeID int64) (ProcessOperationsResult, error)
	ProcessGlobal(ctx context.Context) (ProcessOperationsResult, error)
	Maintain(ctx context.Context) error
	EscalateToFullSync(ctx context.Context, nodeID int64) error
}

type controllerBackend struct{ Controller }

func (b controllerBackend) ProcessNode(ctx context.Context, nodeID int64) (ProcessOperationsResult, error) {
	return b.ProcessQueue(ctx, ProcessOperationsRequest{NodeID: nodeID, Limit: coordinatorBatch})
}

func (b controllerBackend) ProcessGlobal(ctx context.Context) (ProcessOperationsResult, error) {
	return b.ProcessQueue(ctx, ProcessOperationsRequest{GlobalOnly: true, Limit: coordinatorBatch})
}

type nodeWorkerState struct {
	running bool
	dirty   bool
}

type Coordinator struct {
	backend      CoordinatorBackend
	wake         chan struct{}
	sem          chan struct{}
	sleep        func(ctx context.Context, d time.Duration) bool
	safety       time.Duration
	mu           sync.Mutex
	workers      map[int64]*nodeWorkerState
	failures     map[int64]int
	lastMaintain time.Time
	wg           sync.WaitGroup
}

func NewCoordinator(c Controller) *Coordinator {
	return newCoordinator(controllerBackend{c})
}

func newCoordinator(backend CoordinatorBackend) *Coordinator {
	return &Coordinator{
		backend:  backend,
		wake:     make(chan struct{}, 1),
		sem:      make(chan struct{}, coordinatorMaxParallel),
		sleep:    sleepContext,
		safety:   coordinatorSafetyInterval,
		workers:  map[int64]*nodeWorkerState{},
		failures: map[int64]int{},
	}
}

func sleepContext(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func (co *Coordinator) Kick() {
	select {
	case co.wake <- struct{}{}:
	default:
	}
}

func (co *Coordinator) Run(ctx context.Context) {
	ticker := time.NewTicker(co.safety)
	defer ticker.Stop()
	co.dispatch(ctx, true)
	for {
		select {
		case <-ctx.Done():
			co.wg.Wait()
			return
		case <-co.wake:
			co.dispatch(ctx, false)
		case <-ticker.C:
			co.dispatch(ctx, true)
		}
	}
}

func (co *Coordinator) dispatch(ctx context.Context, tick bool) {
	if ctx.Err() != nil {
		return
	}
	if time.Since(co.lastMaintain) >= coordinatorMaintainEvery {
		co.lastMaintain = time.Now()
		if err := co.backend.Maintain(ctx); err != nil && ctx.Err() == nil {
			logging.Warnf(logging.ComponentNode, "node sync maintenance failed: %v", err)
		}
	}
	nodeIDs, hasGlobal, err := co.backend.NodesWithOpenOperations(ctx)
	if err != nil {
		if ctx.Err() == nil {
			logging.Warnf(logging.ComponentNode, "node sync could not list open work: %v", err)
		}
		return
	}
	if hasGlobal {
		globalCtx, cancel := context.WithTimeout(ctx, coordinatorNodeTimeout)
		if _, err := co.backend.ProcessGlobal(globalCtx); err != nil && ctx.Err() == nil {
			logging.Warnf(logging.ComponentNode, "node sync global fan-out failed: %v", err)
		}
		cancel()
		if nodeIDs, _, err = co.backend.NodesWithOpenOperations(ctx); err != nil {
			return
		}
	}
	for _, id := range nodeIDs {
		co.notify(ctx, id)
	}
}

func (co *Coordinator) notify(ctx context.Context, nodeID int64) {
	co.mu.Lock()
	state := co.workers[nodeID]
	if state == nil {
		state = &nodeWorkerState{}
		co.workers[nodeID] = state
	}
	if state.running {
		state.dirty = true
		co.mu.Unlock()
		return
	}
	state.running = true
	co.mu.Unlock()
	co.wg.Add(1)
	go func() {
		defer co.wg.Done()
		co.runNode(ctx, nodeID, state)
	}()
}

func backoffFor(failures int) time.Duration {
	if failures <= 0 {
		return 0
	}
	d := time.Second << uint(failures-1)
	if d > coordinatorMaxBackoff || d <= 0 {
		return coordinatorMaxBackoff
	}
	return d
}

func (co *Coordinator) runNode(ctx context.Context, nodeID int64, state *nodeWorkerState) {
	for {
		co.mu.Lock()
		state.dirty = false
		co.mu.Unlock()
		co.drainNode(ctx, nodeID)
		co.mu.Lock()
		if !state.dirty || ctx.Err() != nil {
			state.running = false
			delete(co.workers, nodeID)
			co.mu.Unlock()
			return
		}
		co.mu.Unlock()
	}
}

func (co *Coordinator) drainNode(ctx context.Context, nodeID int64) {
	for ctx.Err() == nil {
		select {
		case co.sem <- struct{}{}:
		case <-ctx.Done():
			return
		}
		nodeCtx, cancel := context.WithTimeout(ctx, coordinatorNodeTimeout)
		result, err := co.backend.ProcessNode(nodeCtx, nodeID)
		cancel()
		<-co.sem
		failed := err != nil || (result.Retrying > 0 && result.Done == 0)
		co.mu.Lock()
		if failed {
			co.failures[nodeID]++
		} else {
			delete(co.failures, nodeID)
		}
		failures := co.failures[nodeID]
		co.mu.Unlock()
		if !failed {
			if result.Processed == 0 {
				return
			}
			continue
		}
		if failures == coordinatorEscalateAfter {
			if err := co.backend.EscalateToFullSync(ctx, nodeID); err != nil && ctx.Err() == nil {
				logging.Warnf(logging.ComponentNode, "node %d could not queue a full sync: %v", nodeID, err)
			}
		}
		if failures >= coordinatorMaxFailures {
			co.mu.Lock()
			delete(co.failures, nodeID)
			co.mu.Unlock()
			return
		}
		if !co.sleep(ctx, backoffFor(failures)) {
			return
		}
	}
}
