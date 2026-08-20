package common

import "database/sql"

// Env is passed into our application
type Env struct {
	DB *sql.DB
}

// SimpleResponse only returns a status message
type SimpleResponse struct {
	Status string `json:"status"`
}

// CreatedResponse is returned by POST /recipe so the frontend can redirect
// to the new Recipe's detail page without a follow-up GET.
type CreatedResponse struct {
	Status string `json:"status"`
	ID     int    `json:"id"`
}

// ShoppingList contains the data model for a user's list
type ShoppingList struct {
	Recipes     []string                   `json:"recipes"`
	Ingredients map[string]*ListIngredient `json:"ingredients"`
	Extras      map[string]*ListIngredient `json:"extras"`
}

// Ingredient contains ingredient fields
// omitempty on Department: the frontend submits new/edited Ingredient Lines
// as {name, quantity, unit} only - Department is resolved server-side from
// the ingredient_department join table, never supplied by the client.
type Ingredient struct {
	Name       string `json:"name"`
	Unit       string `json:"unit"`
	Quantity   string `json:"quantity"`
	Department string `json:"department,omitempty"`
	// Catalog metadata proposed by Recipe Import for an Ingredient the Global
	// Catalog hasn't seen before - what to add it up in, what to show it as, and
	// how big one of a given Unit of it is. See CONTEXT.md's Unit Size.
	//
	// Only ever fills a gap: a value already recorded for the Ingredient always
	// wins, so a curated figure can't be overwritten by a later import. Absent
	// on Manual Entry and on every edit of an existing Recipe.
	//
	// omitempty on all three, and not merely tidiness: Huma infers required-ness
	// from JSON tags, so without it every existing client's save would fail
	// validation for omitting them (see the ID comment on Recipe below).
	BaseUnit string `json:"baseUnit,omitempty"`
	// A pointer, not a string, because "" is a real Display Unit - the bare
	// count, and the most useful one there is ("6 onions"). A plain string
	// cannot tell "propose showing this as a count" apart from "proposed
	// nothing", so classification could never suggest the count. nil means
	// absent; a pointer to "" means the count.
	//
	// Third time this Unit's name has collided with a sentinel - see
	// baseTotal.soleUnit and IngredientInfo.HasDisplayUnit.
	DisplayUnit *string            `json:"displayUnit,omitempty"`
	UnitSizes   map[string]float64 `json:"unitSizes,omitempty"`
	// PantryStaple is Recipe Import proposing that this Ingredient is a
	// store-cupboard basic. A plain bool rather than a pointer, unlike
	// DisplayUnit above: classification only ever acts on true, so "false" and
	// "not proposed" genuinely are the same thing here and there is no sentinel
	// to collide with.
	PantryStaple bool `json:"pantryStaple,omitempty"`
}

// Tag contains tag fields
type Tag struct {
	Name string `json:"name"`
}

// Recipe contains recipe fields
type Recipe struct {
	Name string `json:"name"`
	// omitempty: a new Recipe (POST /recipe) has no ID yet - the DB assigns
	// one on insert. Huma infers required-ness from JSON tags, so without
	// this a create request without an `id` would fail validation.
	ID          int          `json:"id,omitempty"`
	RemoteURL   string       `json:"remoteUrl"`
	Notes       string       `json:"notes"`
	Method      string       `json:"method"`
	Ingredients []Ingredient `json:"ingredients"`
	Tags        []string     `json:"tags"`
}

// Amount is a quantity paired with a Unit ("400" + "gram"). Quantity is a
// string rather than a number so an Ingredient Line whose quantity can't be
// parsed ("a handful") can still be shown verbatim instead of being dropped -
// and because the underlying column is a varchar already.
type Amount struct {
	Quantity string `json:"quantity"`
	Unit     string `json:"unit"`
	// BaseQuantity/BaseUnit are the same Amount expressed in the Ingredient's
	// Base Unit, set only when Quantity/Unit have been converted into a Display
	// Unit - "2 tins" carries "800 gram" so an approximate Unit Size can't
	// quietly mislead. Flat fields rather than a nested Amount to keep the
	// generated OpenAPI schema non-recursive; omitempty so every other Amount
	// is unchanged.
	BaseQuantity string `json:"baseQuantity,omitempty"`
	BaseUnit     string `json:"baseUnit,omitempty"`
}

// ListIngredient is a subset of shopping List.
//
// Amounts is a list, not a single quantity+unit, because quantities that can't
// be combined must still both reach the shopper: "50 g + 2 tbsp flour" is one
// Item with one checkbox and two Amounts (see CONTEXT.md's Shopping List Item,
// and docs/adr/0005). Extra Items carry an empty Amounts - they're a plain
// checklist entry with no meaningful quantity.
type ListIngredient struct {
	Amounts    []Amount `json:"amounts"`
	IsBought   bool     `json:"isBought"`
	RecipeID   int      `json:"recipe_id"`
	Department string   `json:"department"`
	// PantryStaple marks a store-cupboard basic (salt, oil, flour...) that the
	// frontend groups away by default. Set when the list is read, from the
	// Global Catalog, so flagging an Ingredient improves a list that has already
	// been generated - the same read-time principle as Display Units.
	//
	// omitempty, so every Item that isn't one is byte-for-byte unchanged; Huma
	// infers required-ness from JSON tags, and a `false` here means exactly what
	// an absent field means.
	PantryStaple bool `json:"pantryStaple,omitempty"`
}

// User object
// omitempty on ID/Name: a new user (POST /user) and an invite (POST
// /invite) are sent by the frontend with only a subset of these fields -
// see the ID comment on Recipe above for why that matters to Huma.
// omitempty on Onboarded: it's server-managed and never sent by the client
// as input (POST /user, POST /invite), so without omitempty Huma would mark
// it required on those request bodies. On output, "false" and "absent" are
// equivalent here since the frontend only ever checks it for truthiness.
type User struct {
	ID        string `json:"id,omitempty"`
	Name      string `json:"name,omitempty"`
	Email     string `json:"email"`
	Onboarded bool   `json:"onboarded,omitempty"`
	// ShowPantryStaples is a view preference, not domain state: whether this
	// User wants the Shopping List's Pantry Staples group opened. Server-managed
	// like Onboarded above, hence omitempty for the same reason - it is never
	// sent as input on POST /user or POST /invite, and Huma would otherwise mark
	// it required on those bodies.
	//
	// A pointer, unlike Onboarded, because here `false` is a real answer that
	// has to win. The client caches this value in localStorage and paints from
	// the cache; reconciling means "the server said X, adopt it". With a plain
	// bool, omitempty drops `false` from the JSON, so a preference turned *off*
	// on another device arrives as absent - indistinguishable from "no answer
	// yet" - and every other device keeps showing it on, forever. GetUser always
	// sets it, so it is always present on output. Same reason Ingredient's
	// DisplayUnit is a *string.
	ShowPantryStaples *bool `json:"showPantryStaples,omitempty"`
	// AccountID is the Account this User currently belongs to, or nil if they
	// belong to none.
	//
	// Sent so the browser can name the Account to Google Analytics as a user
	// property - the unit the product questions are actually about ("how many
	// Accounts have ever used Dave") - without a second request for it. Joined
	// into GetUser's existing query rather than resolved separately; see there.
	//
	// A pointer because "belongs to no Account" is a real state rather than
	// account zero: DisableUserAccount leaves exactly that behind when someone
	// accepts an invite into a different Account.
	AccountID *int `json:"accountId,omitempty"`
	// AnalyticsID is the random identifier this User's Account is known by in
	// Google Analytics, or nil if they belong to no Account.
	//
	// **It is sent to Google instead of AccountID, and that is the whole point
	// of it.** A random UUID means `account.id` stops being the same join key
	// across Google, Grafana and our own database, so the mapping table becomes
	// the only place that link exists - backups and logs included - and deleting
	// its row severs it. What that buys is unlinkability, not deletion: Google
	// keeps what it already has, along with its own `_ga` client id and
	// IP-derived geography, whatever we do. See
	// migrations/036_ga_account_uuid.sql.
	//
	// Carried on the User for the same reason AccountID and Consent are: every
	// authenticated page already fetches this object, so a separate route would
	// add a round trip to every load.
	//
	// A pointer, and nil is a normal state rather than an error - a user who
	// belongs to no Account has no Account to name, and a failure to mint one is
	// deliberately swallowed, because analytics must never be why somebody
	// cannot load their recipes.
	AnalyticsID *string `json:"analyticsId,omitempty"`
	// Timezone is the IANA zone name (e.g. "Europe/London") the browser reported
	// when this User first signed up, or "" if it was never captured.
	//
	// It exists for the onboarding email sequence, which sends at 10:00 in the
	// recipient's morning rather than ours - see specs/completed/email.md and
	// migrations/037_user_timezone.sql. Nothing in the UI reads it.
	//
	// **Written once, on insert, and never updated.** service.AddUser leaves it
	// out of the ON DUPLICATE KEY UPDATE clause that refreshes name, email and
	// last_logged_in_at on every login, so a fortnight abroad cannot shift a
	// fortnight-long sequence by nine hours. The empty case is normal, not an
	// error: every row predating the column has none, and the sender falls back
	// to Europe/London.
	//
	// omitempty for the reason Onboarded above gives: it is never sent as input
	// on POST /invite, and Huma infers required-ness from JSON tags, so without
	// it every invite body would be required to carry a timezone. Unlike
	// ShowPantryStaples this is a plain string rather than a pointer, because
	// there is no "explicitly empty" state that has to beat "absent" - both mean
	// the same thing and both take the fallback.
	Timezone string `json:"timezone,omitempty"`
	// Consent is the User's most recent analytics-consent decision, or nil if
	// they have never made one.
	//
	// Carried on the User rather than served from a `GET /consent` of its own,
	// and that is a deliberate trade rather than laziness: every authenticated
	// page already fetches this object for its view preferences, so hanging the
	// decision off it costs nothing, where a second route would add a round trip
	// to every load - the exact cost specs/request-model-optimisations.md is
	// currently working to remove.
	//
	// A pointer for the same reason ShowPantryStaples is one, and then some:
	// here `nil` and "decided false" are genuinely different facts. Nil means
	// nobody has ever asked this user, so the browser's own choice should be
	// pushed up; `{analytics: false}` means they declined, which must not be
	// overwritten by a device that has not been asked. Collapsing the two turns
	// a decline into an invitation to re-ask.
	Consent *Consent `json:"consent,omitempty"`
}

// Consent is one analytics-consent decision, as last recorded for a User.
//
// The policy version travels with the decision rather than being looked up
// separately, because the pair is the fact worth stating: not "they said yes"
// but "they said yes to this text". A client comparing it against the version
// it is currently showing is what makes a material policy change re-ask.
type Consent struct {
	Analytics     bool   `json:"analytics"`
	PolicyVersion string `json:"policyVersion"`
	// DecidedAt is when this decision was recorded, RFC 3339.
	//
	// Sent because the client cannot reconcile without it. Both sides hold a
	// decision and either may be the newer one - a phone that accepted this
	// morning, or this browser declining thirty seconds ago while logged out -
	// and without a time there is no way to tell "another device changed this"
	// from "this device just changed it", so one of the two always loses
	// silently. See components/consent-sync.
	DecidedAt string `json:"decidedAt"`
}

// Account holds accounts and users
type Account struct {
	ID    int    `json:"id"`
	Users []User `json:"users"`
}

// Invite holds information about account collaboration invites
type Invite struct {
	Token         string `json:"token"`
	AccountHolder string `json:"account_holder"`
}
