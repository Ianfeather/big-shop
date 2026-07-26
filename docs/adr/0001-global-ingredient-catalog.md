# Global (not Account-scoped) Ingredient/Unit/Tag/Department catalog

Ingredient, Unit, Tag, and Department are shared across every Account rather than scoped to one — there's exactly one "gram" and one "tomato" in the whole system. This has been true since the schema's earliest migrations (`account`/`account_user` were bolted on in `008_user.sql` after the fact, without ever adding `account_id` to these four tables), and we're keeping it that way deliberately rather than treating it as legacy debt to fix.

The alternative — scoping the catalog per Account — was rejected because it would prevent the catalog from accumulating value across Accounts. `unit-normalisation.md`'s planned Base Unit / Display Unit / Unit Size data (and any future audit/correction of it) only pays off if every Account's usage sharpens the same shared row, rather than each Account re-deriving and re-correcting its own copy from scratch. The data is also low-stakes enough that no Account has a legitimate reason to want a private definition of "gram."

**Consequence worth knowing:** because the catalog is shared, one Account's correction (e.g. fixing a wrong Unit Size) changes what every other Account sees too. This is accepted, not a bug — but note it interacts badly with locale: a US user correcting "tin" from 400g to ~411g would change every UK Account's Shopping List. `unit-normalisation.md` records the single-locale assumption as a known limitation, and revisiting *this* ADR is the prerequisite for Account-scoping the data instead.

*(This ADR originally named the specific fields `average_weight_grams`/`preferred_unit_id`/`density_bucket`. That design was superseded — see [ADR-0004](./0004-unit-size-as-one-relation.md) — but the global-vs-scoped decision recorded here is unchanged.)*
