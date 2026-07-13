# recipe form design thoughts

It's pretty clear that the regex approach isn't good enough, nor is the approach we're taking to scraping the websites. Here are the suggestions I think we should take:

1. We need to rework the third-parties api scraper. Currently it downloads the raw HTML, attempts to find the ingredients on the page using dom selectors and then parses the ingredients using regex. The parse you've written that uses an LLM to extract is much better - but we should also use an LLM to parse the raw HTML that is returned from the URL and identify the list of ingredients.

2. In parse-ingredients.js you're using gpt 3.5-turbo. Let's update the npm package and use the latest cost-effective model https://developers.openai.com/api/docs/models/gpt-5.6-terra.

3. Let's also parse the method at the same time and fill the "method" section of the new recipes form. That should be its own js module but can be called as part of the same client request.

4. Let's also parse whether the recipe is vegetarian and prefill that tag

5. Let's also bring back the recipe name. No need for the user to write that

6. It makes me think the only thing we should show on the initial page is "Recipe URL", "Import from camera" and "Manual Entry". Maybe we show them as tabs because ultimately we'll show the same UI for each of them afterwards (immediately for manual entry) - however for the first 2 they'll be prefilled. The option that should immediately be shown is the URL option.

7. When the user adds a link to the URL we should immediately fetch the information from the URL and populate the name, ingredients and tags. We don't need to have a secondary page (from "Next: Add ingredients") we just need better organisation on the page. This is true for the photo import as well.

7. Once the form has been opened let's organize it a bit better. Maybe 2 columns on desktop:

| Recipe Link | Import from Camera | Enter Manually|
----------------------------------------------------
| Recipe Name        | Tags                         |
----------------------------------------------------
| Ingredients List | Method + Notes                 |

8. For manual ingredients entry we should use the llm parser along with the multiline ingredients input that you designed.

Let's start with these changes for now. Let me know when you have something that I can review.
