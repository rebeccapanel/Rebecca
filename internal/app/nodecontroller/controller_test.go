package nodecontroller

import (
	"reflect"
	"testing"
)

func TestNodeGRPCPortCandidatesPreferDedicatedGRPCPort(t *testing.T) {
	got := NodeGRPCPortCandidates(62033, 62034)
	want := []int{62035}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected candidates: got %v want %v", got, want)
	}
}

func TestNodeGRPCPortCandidatesFallbackToServicePortWithoutAPIPort(t *testing.T) {
	got := NodeGRPCPortCandidates(62033, 0)
	want := []int{62033}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected candidates: got %v want %v", got, want)
	}
}
