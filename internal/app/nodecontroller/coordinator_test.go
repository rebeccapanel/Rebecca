package nodecontroller

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type fakeBackend struct {
	mu         sync.Mutex
	open       map[int64]int
	global     bool
	process    func(nodeID int64) (ProcessOperationsResult, error)
	processed  map[int64]int
	escalated  map[int64]int
	globalRuns int32
	maintained int32
}

func newFakeBackend() *fakeBackend {
	return &fakeBackend{open: map[int64]int{}, processed: map[int64]int{}, escalated: map[int64]int{}}
}

func (f *fakeBackend) NodesWithOpenOperations(context.Context) ([]int64, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	ids := []int64{}
	for id, n := range f.open {
		if n > 0 {
			ids = append(ids, id)
		}
	}
	return ids, f.global, nil
}

func (f *fakeBackend) ProcessNode(_ context.Context, nodeID int64) (ProcessOperationsResult, error) {
	f.mu.Lock()
	f.processed[nodeID]++
	hook := f.process
	f.mu.Unlock()
	if hook != nil {
		return hook(nodeID)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	n := f.open[nodeID]
	f.open[nodeID] = 0
	return ProcessOperationsResult{Processed: n, Done: n}, nil
}

func (f *fakeBackend) ProcessGlobal(context.Context) (ProcessOperationsResult, error) {
	atomic.AddInt32(&f.globalRuns, 1)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.global = false
	f.open[9] = 1
	return ProcessOperationsResult{Processed: 1, Done: 1}, nil
}

func (f *fakeBackend) Maintain(context.Context) error {
	atomic.AddInt32(&f.maintained, 1)
	return nil
}

func (f *fakeBackend) EscalateToFullSync(_ context.Context, nodeID int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.escalated[nodeID]++
	return nil
}

func (f *fakeBackend) processedCount(id int64) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.processed[id]
}

func startCoordinator(t *testing.T, f *fakeBackend) (*Coordinator, context.CancelFunc) {
	t.Helper()
	co := newCoordinator(f)
	co.safety = time.Hour
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { co.Run(ctx); close(done) }()
	t.Cleanup(func() { cancel(); <-done })
	return co, cancel
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestCoordinatorProcessesOnlyNodesWithOpenWorkWhenKicked(t *testing.T) {
	f := newFakeBackend()
	co, _ := startCoordinator(t, f)
	f.mu.Lock()
	f.open[1] = 3
	f.open[2] = 0
	f.mu.Unlock()
	co.Kick()
	waitFor(t, "node 1 to be processed", func() bool { return f.processedCount(1) >= 1 })
	time.Sleep(50 * time.Millisecond)
	if f.processedCount(2) != 0 {
		t.Fatal("a node without open work must not be touched")
	}
}

func TestCoordinatorSlowNodeDoesNotDelayOtherNodes(t *testing.T) {
	f := newFakeBackend()
	release := make(chan struct{})
	f.process = func(nodeID int64) (ProcessOperationsResult, error) {
		if nodeID == 1 {
			<-release
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		n := f.open[nodeID]
		f.open[nodeID] = 0
		return ProcessOperationsResult{Processed: n, Done: n}, nil
	}
	co, _ := startCoordinator(t, f)
	f.mu.Lock()
	f.open[1] = 1
	f.open[2] = 1
	f.mu.Unlock()
	co.Kick()
	waitFor(t, "fast node to finish while node 1 hangs", func() bool {
		f.mu.Lock()
		defer f.mu.Unlock()
		return f.open[2] == 0
	})
	close(release)
}

func TestCoordinatorCoalescesKicksIntoOneWorkerPerNode(t *testing.T) {
	f := newFakeBackend()
	var running, maxRunning int32
	gate := make(chan struct{})
	f.process = func(nodeID int64) (ProcessOperationsResult, error) {
		cur := atomic.AddInt32(&running, 1)
		for {
			prev := atomic.LoadInt32(&maxRunning)
			if cur <= prev || atomic.CompareAndSwapInt32(&maxRunning, prev, cur) {
				break
			}
		}
		<-gate
		atomic.AddInt32(&running, -1)
		f.mu.Lock()
		defer f.mu.Unlock()
		n := f.open[nodeID]
		f.open[nodeID] = 0
		return ProcessOperationsResult{Processed: n, Done: n}, nil
	}
	co, _ := startCoordinator(t, f)
	f.mu.Lock()
	f.open[1] = 1
	f.mu.Unlock()
	for i := 0; i < 20; i++ {
		co.Kick()
		time.Sleep(time.Millisecond)
	}
	close(gate)
	waitFor(t, "node drained", func() bool {
		f.mu.Lock()
		defer f.mu.Unlock()
		return f.open[1] == 0
	})
	if atomic.LoadInt32(&maxRunning) != 1 {
		t.Fatalf("a node must never be processed twice at once, saw %d", maxRunning)
	}
}

func TestCoordinatorKickDuringProcessingTriggersAnotherPass(t *testing.T) {
	f := newFakeBackend()
	first := make(chan struct{})
	var calls int32
	f.process = func(nodeID int64) (ProcessOperationsResult, error) {
		n := atomic.AddInt32(&calls, 1)
		if n == 1 {
			<-first
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		c := f.open[nodeID]
		f.open[nodeID] = 0
		return ProcessOperationsResult{Processed: c, Done: c}, nil
	}
	co, _ := startCoordinator(t, f)
	f.mu.Lock()
	f.open[1] = 1
	f.mu.Unlock()
	co.Kick()
	waitFor(t, "first pass to start", func() bool { return atomic.LoadInt32(&calls) >= 1 })
	f.mu.Lock()
	f.open[1] = 5
	f.mu.Unlock()
	co.Kick()
	time.Sleep(30 * time.Millisecond)
	close(first)
	waitFor(t, "work added mid-pass to be processed", func() bool {
		f.mu.Lock()
		defer f.mu.Unlock()
		return f.open[1] == 0
	})
}

func TestCoordinatorCoolsDownFailingNodeAndEscalatesOnce(t *testing.T) {
	f := newFakeBackend()
	f.process = func(nodeID int64) (ProcessOperationsResult, error) {
		return ProcessOperationsResult{}, errors.New("node unreachable")
	}
	co, _ := startCoordinator(t, f)
	var clock atomic.Int64
	base := time.Now()
	co.now = func() time.Time { return base.Add(time.Duration(clock.Load())) }
	f.mu.Lock()
	f.open[1] = 1
	f.mu.Unlock()
	pass := func(want int) {
		t.Helper()
		co.Kick()
		waitFor(t, "pass", func() bool { return f.processedCount(1) >= want })
		time.Sleep(30 * time.Millisecond)
	}
	pass(1)
	co.Kick()
	time.Sleep(50 * time.Millisecond)
	if f.processedCount(1) != 1 {
		t.Fatal("a failing node must not be retried during its cooldown")
	}
	clock.Add(int64(2 * time.Second))
	pass(2)
	clock.Add(int64(3 * time.Second))
	pass(3)
	f.mu.Lock()
	escalated := f.escalated[1]
	f.mu.Unlock()
	if escalated != 1 {
		t.Fatalf("the third consecutive failure queues one full sync, got %d", escalated)
	}
	clock.Add(int64(10 * time.Second))
	pass(4)
	f.mu.Lock()
	escalated = f.escalated[1]
	f.mu.Unlock()
	if escalated != 1 {
		t.Fatalf("escalation must not repeat on every failure, got %d", escalated)
	}
}

func TestCoordinatorSuccessClearsTheCooldown(t *testing.T) {
	f := newFakeBackend()
	var fail atomic.Bool
	fail.Store(true)
	f.process = func(nodeID int64) (ProcessOperationsResult, error) {
		if fail.Load() {
			return ProcessOperationsResult{}, errors.New("down")
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		n := f.open[nodeID]
		f.open[nodeID] = 0
		return ProcessOperationsResult{Processed: n, Done: n}, nil
	}
	co, _ := startCoordinator(t, f)
	var clock atomic.Int64
	base := time.Now()
	co.now = func() time.Time { return base.Add(time.Duration(clock.Load())) }
	f.mu.Lock()
	f.open[1] = 1
	f.mu.Unlock()
	co.Kick()
	waitFor(t, "first failure", func() bool { return f.processedCount(1) >= 1 })
	fail.Store(false)
	clock.Add(int64(time.Minute))
	co.Kick()
	waitFor(t, "recovery", func() bool {
		f.mu.Lock()
		defer f.mu.Unlock()
		return f.open[1] == 0
	})
	co.mu.Lock()
	_, cooling := co.cooldown[1]
	co.mu.Unlock()
	if cooling {
		t.Fatal("a successful pass must clear the cooldown")
	}
}

func TestCoordinatorRunsGlobalFanOutBeforeDispatchingNodes(t *testing.T) {
	f := newFakeBackend()
	f.global = true
	co, _ := startCoordinator(t, f)
	co.Kick()
	waitFor(t, "node created by the global fan-out to be processed", func() bool { return f.processedCount(9) >= 1 })
	if atomic.LoadInt32(&f.globalRuns) != 1 {
		t.Fatalf("global ops ran %d times", f.globalRuns)
	}
}

func TestCoordinatorSafetyTickPicksUpWorkWithoutAKick(t *testing.T) {
	f := newFakeBackend()
	co := newCoordinator(f)
	co.safety = 20 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { co.Run(ctx); close(done) }()
	defer func() { cancel(); <-done }()
	f.mu.Lock()
	f.open[3] = 2
	f.mu.Unlock()
	waitFor(t, "safety tick to dispatch node 3", func() bool { return f.processedCount(3) >= 1 })
	if atomic.LoadInt32(&f.maintained) == 0 {
		t.Fatal("maintenance must run")
	}
}

func TestBackoffForIsCapped(t *testing.T) {
	if backoffFor(0) != 0 || backoffFor(1) != time.Second || backoffFor(5) != 16*time.Second || backoffFor(9) != 256*time.Second || backoffFor(10) != coordinatorMaxBackoff || backoffFor(60) != coordinatorMaxBackoff {
		t.Fatal("backoff schedule is wrong")
	}
}

func TestCoordinatorTreatsAPartiallyFailingPassAsAFailure(t *testing.T) {
	f := newFakeBackend()
	f.process = func(nodeID int64) (ProcessOperationsResult, error) {
		return ProcessOperationsResult{Processed: 5, Done: 4, Retrying: 1}, nil
	}
	co, _ := startCoordinator(t, f)
	f.mu.Lock()
	f.open[1] = 5
	f.mu.Unlock()
	co.Kick()
	waitFor(t, "first pass", func() bool { return f.processedCount(1) >= 1 })
	time.Sleep(30 * time.Millisecond)
	co.mu.Lock()
	failures := co.failures[1]
	_, cooling := co.cooldown[1]
	co.mu.Unlock()
	if failures != 1 || !cooling {
		t.Fatalf("a node that keeps failing part of its work must cool down, failures=%d cooling=%v", failures, cooling)
	}
	co.Kick()
	time.Sleep(50 * time.Millisecond)
	if f.processedCount(1) != 1 {
		t.Fatal("the node must not be retried during its cooldown")
	}
}
