package lifecycle

import (
	"log"
	"os"
	"strconv"
)

// enabledVar is the switch for the whole onboarding programme.
const enabledVar = "ONBOARDING_EMAIL_ENABLED"

// Enabled reports whether the onboarding sequence may send anything.
//
// **Off unless explicitly turned on**, and that default is the point of it. The
// external setup - a live SendGrid key, a verified sender, and an ASM group -
// all landed before the code did, so without this flag the sequence would begin
// mailing real people the moment it merged, on the strength of a deploy nobody
// had deliberately timed. Merging and switching on are now two decisions instead
// of one.
//
// Note what it deliberately does *not* gate:
//
//   - **`send-test`**, which is the whole point of merging this switched off.
//     Its job is to put a real message in a real inbox so the copy, the
//     rendering and the unsubscribe link can be checked before anyone else gets
//     one, and gating it would make the flag mean "and you cannot test it
//     either".
//   - **The Account invite**, which is transactional and predates all of this.
//     It is something a user asked for by inviting somebody thirty seconds
//     earlier, not part of the programme this flag governs.
//
// Read per call rather than captured at startup, matching SENDGRID_API_KEY and
// for the same reason: nothing about configuration should be able to decide
// whether the process starts.
func Enabled() bool {
	raw := os.Getenv(enabledVar)
	if raw == "" {
		return false
	}
	// ParseBool rather than a `== "true"` comparison, so the obvious spellings
	// somebody will actually type - "1", "TRUE", "True" - all work. Anything
	// unparseable is treated as off and said out loud, because the alternative
	// is a typo that silently means "keep everything switched off" and looks
	// exactly like the flag not working.
	on, err := strconv.ParseBool(raw)
	if err != nil {
		log.Printf("lifecycle: %s=%q is not a boolean; onboarding email stays off", enabledVar, raw)
		return false
	}
	return on
}
