---
title: "Why we built Big Shop"
date: "2026-09-06"
description: "The short version of why Big Shop exists: recipes people already have, and a shopping list that finally knows what's in them."
---

Most of the recipes a household actually cooks are not in a cookbook. They are a screenshot from somebody's Instagram story, a link a friend sent eight months ago, a handwritten card that lives in a drawer, three browser tabs kept open because closing them would mean losing them. None of that is searchable. None of it survives a phone getting replaced. And none of it turns into a shopping list on its own.

That gap — between having a recipe and being ready to cook it — is what Big Shop is for.

## Collecting a recipe should take one click, not a rewrite

A recipe can arrive here three ways, and all of them should end up looking the same:

- **A link.** Paste it in, and the ingredients and method come out separated, with nothing retyped by hand.
- **A photo.** Photograph a page from an actual cookbook and the same thing happens.
- **Pasted text.** Copy a recipe from anywhere — a message, a forum post — and paste it in directly.

That is the whole of what "importing" means here. It is not clever; it is just the step everyone currently does by hand, done once, automatically.

## A shopping list that already knows what a tin of tomatoes is

Pick a handful of recipes for the week and the ingredients across all of them should combine into *one* list — not five separate copies of "1 onion". That sounds obvious until you try to build it: ingredient names are written inconsistently everywhere they come from, and combining them well means recognising that "chopped tomatoes" and "tin of chopped tomatoes" are the same thing before the list is generated, not after. Getting that right, quietly, in the background, is most of the actual engineering in this app.

## What we are not trying to be

Big Shop does not do meal-planning calendars, macro tracking, or grocery delivery. Those are real products solving real problems, just not this one. The bet here is narrower: that most of the friction in home cooking is upstream of the cooking itself — in deciding what to make, and in turning that decision into a list you can actually shop from — and that getting *that* right is worth doing properly, rather than as a feature bolted onto something bigger.

## Where this is going

This is the first post here, and there will be more as the app changes — what shipped, what didn't work, what we changed our mind about. If you have opinions on any of it, [the support page](/support) reaches a real person, and reads every message.
