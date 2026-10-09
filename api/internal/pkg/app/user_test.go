package app

import (
	"testing"

	"recipes/internal/pkg/common"
)

// The guard specs/completed/sample-seeded-accounts.md's Phase 1 added: seeding must not
// fire for someone whose first POST /user is actually the first step of
// accepting an invite, since LinkOrCreateIdentity's "genuinely new person"
// branch mints them a solo Account they are about to abandon the moment
// acceptInvite runs, not the shared one they are joining.
func TestShouldSeed(t *testing.T) {
	tests := []struct {
		name    string
		invites []common.Invite
		want    bool
	}{
		{name: "no pending invite, seed", invites: nil, want: true},
		{name: "empty slice, seed", invites: []common.Invite{}, want: true},
		{
			name:    "a pending invite, do not seed",
			invites: []common.Invite{{Token: "t", AccountHolder: "Someone"}},
			want:    false,
		},
		{
			name: "several pending invites, still do not seed",
			invites: []common.Invite{
				{Token: "t1", AccountHolder: "Someone"},
				{Token: "t2", AccountHolder: "Someone Else"},
			},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := shouldSeed(tt.invites); got != tt.want {
				t.Errorf("shouldSeed(%v) = %v, want %v", tt.invites, got, tt.want)
			}
		})
	}
}
