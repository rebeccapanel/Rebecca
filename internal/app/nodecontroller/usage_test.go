package nodecontroller

import "testing"

func TestUsageCollectionResetsXrayCountersByDefault(t *testing.T) {
	cases := []struct {
		name string
		req  CollectUsageRequest
		want bool
	}{
		{name: "empty request resets", req: CollectUsageRequest{}, want: true},
		{name: "worker request resets", req: CollectUsageRequest{Users: true, Outbound: true, Reset: true}, want: true},
		{name: "legacy false still resets safely", req: CollectUsageRequest{Users: true, Outbound: true, Reset: false}, want: true},
		{name: "explicit no reset disables reset", req: CollectUsageRequest{NoReset: true}, want: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := usageCollectionShouldReset(tc.req); got != tc.want {
				t.Fatalf("usageCollectionShouldReset() = %v, want %v", got, tc.want)
			}
		})
	}
}
