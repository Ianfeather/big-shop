package app

import (
	"context"
	"encoding/json"
)

// The namespaced claims a post-login Action puts on the access token, carrying
// the email address the identity provider itself asserted.
//
// **Namespaced because Auth0 requires it, and silently.** A custom claim whose
// name is not a URI in a namespace the tenant owns is dropped from the token
// without an error anywhere - so the failure mode of getting this wrong is not
// a rejected token but an absent claim, which every reader here treats as "this
// person has no verified address". Changing either string means changing
// auth0/actions/add-verified-email-claim.js in the same commit; nothing checks
// that they agree, because nothing can.
const (
	emailClaim         = "https://bigshop.life/email"
	emailVerifiedClaim = "https://bigshop.life/email_verified"
)

// bigshopClaims is the custom half of a validated access token.
//
// It exists so the API can know a caller's email address **without asking the
// caller**. Before it, the only thing lifted out of the signed token was `sub`,
// and every other fact about the person came from the POST /user request body -
// including the email address that `invite.email` is matched against, which
// made "which invitations may I see" a question the requester answered about
// themselves.
type bigshopClaims struct {
	Email         string   `json:"https://bigshop.life/email"`
	EmailVerified flexBool `json:"https://bigshop.life/email_verified"`
}

// Validate satisfies validator.CustomClaims.
//
// Deliberately empty, and that is not laziness: returning an error here fails
// the whole token and answers 401. Nothing about these claims is a reason to
// refuse a request - a token without them is a token from before the Action
// existed, and a caller with no verified address is a supported state
// everywhere it matters. The decisions belong at the call sites, which can
// answer "no invitations" instead of "you are not logged in".
func (c *bigshopClaims) Validate(context.Context) error { return nil }

// VerifiedEmail returns the address only if the provider vouched for it, and ""
// otherwise.
//
// **The two fields are never read separately outside this method**, which is
// the point of having it: an address whose verification flag was not checked is
// exactly as untrustworthy as one out of the request body, and a caller reading
// `.Email` directly would reintroduce the vulnerability this whole change
// closes while looking perfectly reasonable.
func (c *bigshopClaims) VerifiedEmail() string {
	if c == nil || !bool(c.EmailVerified) {
		return ""
	}
	return c.Email
}

// flexBool is a bool that will not fail a token if it arrives as something else.
//
// **This is an outage guard, not tolerance for sloppiness.** Custom claims are
// unmarshalled as part of token validation, so a claim that will not decode
// makes go-jwt-middleware reject the token - and since this claim is on *every*
// token the tenant issues, one Action edit that emitted `"true"` instead of
// `true` would 401 the entire userbase at once, with the API's own logs saying
// only "JWT is invalid."
//
// The value decides whether someone sees their invitations. It is not worth the
// blast radius of being strict about its JSON type, so anything that is not a
// recognisable true becomes false and the caller is treated as having no
// verified address - the safe direction, and the same answer a pre-Action token
// gets.
type flexBool bool

func (b *flexBool) UnmarshalJSON(data []byte) error {
	var asBool bool
	if err := json.Unmarshal(data, &asBool); err == nil {
		*b = flexBool(asBool)
		return nil
	}

	var asString string
	if err := json.Unmarshal(data, &asString); err == nil {
		*b = asString == "true"
		return nil
	}

	// Null, a number, an object - anything at all. Not an error: see above.
	*b = false
	return nil
}
