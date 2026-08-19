import { test, expect } from './fixtures';
import { API_HOST } from './env';

// Account deletion, from the account page.
//
// **Nothing in this file calls DELETE /account, and that is deliberate rather
// than a gap.** Under DISABLE_AUTH every request in the whole run resolves to
// the same fixed dev user and Account, and Playwright runs spec *files* in
// parallel - so a test that really deleted the account would wipe the recipes
// and shopping list that recipe.spec.ts and shopping-list.spec.ts are midway
// through using. CLAUDE.md already names a weaker version of this hazard for
// the Shopping List; deletion is the strongest possible form of it, because
// there is no second account to act as and no way to put the first one back
// within the run.
//
// So this covers the part that is specific to the UI and cannot be covered
// anywhere else: **that the confirmation names which of the two outcomes will
// happen before you commit to it.** That sentence is the whole reason the panel
// exists - the difference between "your recipes are deleted" and "your recipes
// stay with the people you share with" is invisible otherwise, and is the thing
// users would be angriest about getting wrong.
//
// The cascade itself, both branches, the five-step sequence and the Auth0 abort
// are covered by Go tests in internal/pkg/service, which can construct a shared
// account and a sole-member account without either being the one the rest of
// the suite is standing on.
test.describe('deleting your account', () => {
  test('the control is present but does nothing until confirmed', async ({ page }) => {
    await page.goto('/account');

    const open = page.getByRole('button', { name: 'Delete your account' });
    await expect(open).toBeVisible();

    // Nothing destructive may be one click away.
    await expect(page.getByRole('button', { name: 'Yes, delete my account' })).toBeHidden();
  });

  test('confirming names the outcome that matches who is on the account', async ({ page, request }) => {
    // The branch is checked against what the API independently reports rather
    // than against a hard-coded expectation, and that matters twice over.
    //
    // It is a real cross-check: `GET /account` returns the Account's enabled
    // members, which is the same question `service.OtherAccountMembers` asks
    // when it decides which cascade to run. If the UI's copy and the server's
    // branch ever disagree, someone is told their recipes are safe while they
    // are deleted, or the reverse.
    //
    // And it survives the seed changing. The dev Account is *shared* - both
    // migrations/008_user.sql and docker/mysql-seed/dev-seed.sql put a user on
    // account 1 - which is not obvious and cost this test one wrong assertion
    // already. A hard-coded expectation would go green again the day somebody
    // changes the seed, for the wrong reason.
    const account = await (await request.get(`${API_HOST}/account`)).json();
    const shared = account.users.length > 1;

    await page.goto('/account');
    await page.getByRole('button', { name: 'Delete your account' }).click();

    const stays = page.getByText(/Your recipes will stay/);
    const deleted = page.getByText('Your recipes will be deleted.');

    if (shared) {
      await expect(stays).toBeVisible();
      // It must not simultaneously claim the other outcome.
      await expect(deleted).toBeHidden();
      // And it names how many people are affected, since "shared" alone does
      // not tell you whether that is one person or five.
      await expect(page.getByText(new RegExp(`${account.users.length - 1} other`))).toBeVisible();
    } else {
      await expect(deleted).toBeVisible();
      await expect(stays).toBeHidden();
    }

    await expect(page.getByText('This cannot be undone.')).toBeVisible();
  });

  test('cancelling puts it away and deletes nothing', async ({ page, request }) => {
    await page.goto('/account');
    await page.getByRole('button', { name: 'Delete your account' }).click();
    await expect(page.getByRole('button', { name: 'Yes, delete my account' })).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('button', { name: 'Yes, delete my account' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Delete your account' })).toBeVisible();

    // And the account is still there afterwards. Cheap, but it is the assertion
    // that would fail loudest if opening the panel ever started doing the thing
    // it is only supposed to describe.
    const res = await request.get(`${API_HOST}/user`);
    expect(res.ok()).toBeTruthy();
  });
});
