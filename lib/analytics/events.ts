import { trackEvent } from './ga';

// The complete list of events Big Shop sends to Google Analytics. Four, and the
// list is meant to stay about this long.
//
// **An event goes here only when the question it answers is longitudinal.**
// Otherwise it stays a Grafana metric. The test is whether answering it needs
// more than fourteen days of history - which is Grafana Cloud Free's retention,
// and the entire reason GA is in scope at all (specs/observability.md puts
// long-horizon product questions explicitly out of scope for Grafana and names
// GA as their home).
//
// That rule is what stops this file growing into a second copy of the metrics.
// `specs/observability.md` already specifies an import-outcome counter by source
// and result, and a request-duration histogram by route; both answer "is it
// working right now", and duplicating them here would cost a fourth-party
// transfer to answer a question a dashboard already answers better.
//
// Applied to the four below:
//
//   - **Recipe imported**, by Source. "Do people paste links or type them out,
//     and has that changed since we improved the extractor" is a question about
//     months. The Grafana counter cannot answer it - see the Source note below.
//   - **Shopping list generated.** Whether the core loop is actually used, and
//     how that tracks against onboarding changes (follow-ups.md #42).
//   - **Dave turn.** The literal example in follow-ups.md #43: "is Dave used
//     more than three months ago".
//   - **Invite sent.** Sharing an Account is, per CONTEXT.md, one of the
//     product's reasons to exist, and #46 records that the entry point to it has
//     been broken. Whether anyone succeeds at it is a trend, not a gauge.
//
// **No parameter carries content.** Not Recipe names, not Dave's messages, not
// email addresses. Same rule as ADR-0008 §1, enforced here at a second
// boundary: every parameter below is drawn from a closed set of values written
// in this file.

// How a Recipe came into the collection.
//
// **Deliberately not the same set as `lib/telemetry/metrics.ts`'s
// `ImportSource`,** and the difference is the point rather than an oversight.
// That type describes *extractions*, so it has `method-url` and `method-photo`
// and no `manual` at all - typing a recipe out never runs an extractor and so
// never records an outcome. The question here is how recipes arrive, and typing
// is one of the answers.
//
// `text` is the bulk paste box rather than a tab of its own: a cook who chose
// Enter Manually and then pasted their ingredient list in one lump had the list
// read for them, which is a different act from typing eleven rows, and the
// distinction is exactly what "should we make paste more prominent" turns on.
export type RecipeSource = 'url' | 'photo' | 'text' | 'manual';

export function recipeImported(source: RecipeSource): void {
  trackEvent('recipe_imported', { source });
}

// One generation of the Shopping List - the moment the week's chosen Recipes
// become a list to shop from.
export function shoppingListGenerated(): void {
  trackEvent('shopping_list_generated');
}

// One exchange with Dave: a question asked and answered.
//
// Counted per turn rather than per conversation because a conversation has no
// end event to hang a count on - nobody closes a chat, they just stop - so
// "sessions" would be an artefact of whatever timeout defined them.
export function daveTurn(): void {
  trackEvent('dave_turn');
}

// An Account invite sent.
//
// Fired on the request succeeding, not on the click. #46 records that
// `POST /invite` currently 400s whenever the email fails to send, which is
// always, so a click-counted version of this would report a thriving sharing
// feature that has never once worked.
export function inviteSent(): void {
  trackEvent('invite_sent');
}
