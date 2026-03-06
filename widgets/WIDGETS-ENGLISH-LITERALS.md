# English literals in `/widgets` (copy & fallbacks)

All user-facing English strings used as copy, fallbacks (`|| '...'`, `?? '...'`), or hardcoded in HTML/JS across widgets. Forms use locale JSON for labels and input hints; their **default English fallbacks** are included where set in JS. Literals are listed once with every widget that uses them.

---

## Literal → Widget(s)

| English literal | Widget(s) |
|-----------------|-----------|
| **—** (em dash, empty value) | compare-products |
| **×** (remove button) | compare-products |
| **✓** (checkmark) | compare-products |
| **0 of 5 stars** | recipe-center |
| **1** (pagination) | search-results, recipe-center, article-center |
| **2-4 Individuals** | blender-recommender |
| **4+ Individuals** | blender-recommender |
| **Address, City, or Zipcode** | locator |
| **All** | search-results |
| **Add a product to compare** | compare-products (translation key) |
| **Add to comparison** | compare-products (translation key) |
| **All selected. Remove one to add another.** | compare-products (translation key) |
| **Article** | search-results |
| **Articles** (e.g. Newest Articles) | article-center |
| **Back** | blender-recommender |
| **Blending Needs** | blender-recommender |
| **Blending Programs** | compare-products |
| **By** | article-center |
| **CAD** | compare-products |
| **Check** | compare-products (translation key) |
| **Clear All** | recipe-center |
| **Color** / **Colors** | compare-products |
| **Commercial Events** | locator |
| **Commercial Products** | locator |
| **Compatible Containers** | recipe-center |
| **Continue** | blender-recommender |
| **Course** | recipe-center |
| **Could not load this product.** | compare-products (translation key) |
| **Countertop Blender** | compare-products |
| **Default** | article-center |
| **Demonstrations** | locator |
| **Dietary** | recipe-center |
| **Dietary Interests** | recipe-center |
| **Digital Timer** | compare-products |
| **Dimensions (L × W × H)** | compare-products |
| **Distributors** | locator |
| **Difficulty** | recipe-center |
| **Dressings** (and other q2 options) | blender-recommender |
| **En savoir plus** | compare-products (translation key) |
| **Featured** | recipe-center |
| **Find Locally** | locator |
| **Finish** | blender-recommender |
| **from comparison** | compare-products (translation key) |
| **Go** | simple-search, recipe-center |
| **Household Events** | locator |
| **I Prefer Basic Colors** | blender-recommender |
| **I Want a Variety of Color Options** | blender-recommender |
| **Items** | recipe-center |
| **Just Me** | blender-recommender |
| **Local Representatives** | locator |
| **miles away** | locator |
| **Name (A-Z)** | recipe-center |
| **Name (Z-A)** | recipe-center |
| **Name (optional)** | blender-recommender |
| **Newest Articles** | article-center |
| **Next** | search-results, recipe-center, article-center, blender-recommender |
| **No countertop blenders found.** | compare-products (translation key) |
| **Now** | compare-products (translation key) |
| **of** | search-results, recipe-center, article-center |
| **Oldest Articles** | article-center |
| **Online Retailers** | locator |
| **Page** | search-results |
| **Phone: ** | locator |
| **Previous** | search-results, recipe-center, article-center |
| **product** | compare-products (translation key) |
| **Product** | search-results |
| **Product not found (404).** | compare-products (translation key) |
| **Pulse** | compare-products |
| **Recipe** | search-results |
| **Recipe Type** | recipe-center |
| **Refine Your Recipe** | recipe-center |
| **Refine Your Search** | recipe-center |
| **Remove** | compare-products (translation key) |
| **Remove from comparison** | compare-products (translation key) |
| **Retailers** | locator |
| **Save** | compare-products (translation key) |
| **Search** | simple-search, search-results, article-center, locator |
| **See Results** | recipe-center |
| **Self-Detect Technology** | compare-products |
| **Series** | compare-products |
| **Show** / **Showing** | search-results, article-center |
| **Sort By** / **Sort by** | recipe-center, article-center |
| **Starting at** | compare-products (translation key) |
| **Tamper Indicator** | compare-products |
| **Time (High to Low)** | recipe-center |
| **Time (Low to High)** | recipe-center |
| **Touch Buttons** | compare-products |
| **Type to search recipes** | recipe-center |
| **Variable Speed Control** | compare-products |
| **View Details** | compare-products (translation key) |
| **Was** | compare-products (translation key) |
| **Warranty** | compare-products |
| **Website: ** | locator |
| **What are you looking for?** | locator |
| **Yes** | compare-products (translation key) |
| **Your Location** | locator |
| **…** (ellipsis) | search-results, recipe-center, article-center |
| **+15 secondes** / **Plus 15 Second Button** | compare-products |
| ** - ** (dash between range) | recipe-center |
| **USD** | compare-products |

---

## Used by multiple widgets

These literals appear in more than one widget (good candidates for shared i18n).

### Non-form widgets

| Literal | Widgets |
|---------|---------|
| **1** (pagination) | search-results, recipe-center, article-center |
| **Go** | simple-search, recipe-center |
| **Next** | search-results, recipe-center, article-center, blender-recommender |
| **of** | search-results, recipe-center, article-center |
| **Previous** | search-results, recipe-center, article-center |
| **Search** | simple-search, search-results, article-center, locator |
| **Showing** | search-results, article-center |
| **…** (ellipsis) | search-results, recipe-center, article-center |

### Forms

| Literal | Widgets |
|---------|---------|
| **Address** | product-registration, manage-address |
| **Address Line 2** | product-registration, manage-address |
| **Additional comments** | wellness-program, media-contact |
| **City** | product-registration, manage-address |
| **Do you own a Vitamix?** | edit-account, create-account |
| **Email Address** | product-registration, media-contact, login, edit-account, create-account, contact-us |
| **First Name** | product-registration, media-contact, manage-address, edit-account, create-account, contact-us |
| **Last Name** | product-registration, media-contact, manage-address, edit-account, create-account, contact-us |
| **Phone Number** | product-registration, wellness-program, media-contact, manage-address |
| **Postal code** | product-registration, manage-address, edit-account, create-account |
| **Submit** | wellness-program, media-contact, login, contact-us |
| **Yes** | edit-account, create-account |
| **No** | edit-account, create-account |

---

## By widget (summary)

### compare-products
Translation keys (via `t()`) used as UI text; actual copy comes from the widget’s local JSON. Hardcoded literals: feature row names (Series, Blending Programs, Variable Speed Control, Touch Buttons, Pulse, Digital Timer, Self-Detect Technology, Tamper Indicator, Plus 15 Second Button, Warranty, Dimensions (L × W × H), Colors), currency (USD, CAD), Countertop Blender, Color, and symbols ×, ✓, —.

### search-results
Placeholder/fallback literals: Article, Recipe, Page, Product, All, Previous, Next, Search, Showing, of; pagination uses numeric strings and ellipsis (…).

### simple-search (form)
Hardcoded in HTML: **Search** (input hint, label, aria-label), **Go** (button).

### locator
HTML: Find Locally, Your Location, Address, City, or Zipcode, What are you looking for?, Commercial Products, Demonstrations, Search, Retailers, Online Retailers, Distributors, Local Representatives, Household Events, Commercial Events. JS: "miles away", "Phone: ", "Website: ".

### recipe-center
Placeholder fallbacks: Difficulty, Compatible Containers, Dietary Interests, Course, Recipe Type, Previous, Next, Clear All, Type to search recipes, Go, Items, of, Featured, Sort By, Name (A-Z), Name (Z-A), Time (Low to High), Time (High to Low), Refine Your Recipe, See Results, Refine Your Search, Dietary, Course, Recipe Type. HTML defaults: same in recipe-center.html. Accessibility: "0 of 5 stars", "☆".

### article-center
Placeholder fallbacks: By, Previous, Next, Search, Showing, of, Sort by, Newest Articles, Default, Oldest Articles, Name A-Z, Name Z-A.

### blender-recommender
Large set of English (and French) strings in default content: intro (eyebrow, headline, name/email labels, promo, Skip, Continue), quiz (tab names, question text, options e.g. Durable & Simple, Smoothies, Meal Prep, Just Me, 2-4 Individuals, 4+ Individuals, color options), results (Meet Your New Blender, More Details, Start Over, etc.), and static blocks (Features & Details, Why Buy a Vitamix, Free Shipping, etc.). All are literals in `blender-recommender.js`.

---

## Forms (locale-driven; English fallbacks in JS/JSON)

Forms use `labels` and `inputPlaceholders` from locale JSON; the following are the **default English** values used when locale strings are missing (`?? '...'` in JS or in JSON).

| Literal | Widget (form) |
|---------|----------------|
| About your blender | product-registration |
| About you | product-registration |
| Account Information | edit-account |
| Additional Comments (Optional) | media-contact |
| Address | product-registration, manage-address |
| Address Line 2 | product-registration, manage-address |
| All fields are mandatory... | edit-account |
| At home | product-registration |
| Business Line | media-contact |
| Cancel | manage-address |
| Choose your province | product-registration |
| City | product-registration, manage-address |
| Clear form | product-registration |
| Click here to consult our  | product-registration |
| Commercial | contact-us |
| Company | manage-address |
| Confirm Email Address | create-account |
| Contact Information | manage-address |
| Create account | create-account |
| Default | article-center (sort) |
| Domestic | contact-us |
| Do you own a Vitamix? | edit-account, create-account |
| Email Address | product-registration, media-contact, login, edit-account, create-account, contact-us |
| Find your serial number | product-registration |
| First Name | product-registration, media-contact, manage-address, edit-account, create-account, contact-us |
| For commercial products | create-account |
| For domestic products | create-account |
| I accept the terms & conditions... | product-registration |
| I plan to use it | product-registration |
| In a business | product-registration |
| Last Name | (same forms as First Name) |
| Manage address | manage-address |
| No, do not send me electronic mail | edit-account |
| Order Number | order-status |
| Other remarks / Additional comments | wellness-program, media-contact |
| Phone Number | product-registration, wellness-program, media-contact, manage-address |
| Please select a region, state or province | manage-address |
| Postal code | product-registration, manage-address, edit-account, create-account |
| Postal code (optional) | edit-account |
| Privacy policy / terms links | product-registration |
| Publication / Company (Optional) | media-contact |
| Purchased from | product-registration |
| Purchased on | product-registration |
| Reason for communication | contact-us |
| Reason for Contact | media-contact |
| Register | product-registration |
| Save address | manage-address |
| Save changes | edit-account |
| Search Order | order-status |
| Select / Select an option | contact-us, product-registration |
| Serial number / (18 digits) | product-registration |
| Sending... / Searching... | multiple forms |
| Submit | wellness-program, media-contact, login, contact-us |
| Type of request | contact-us |
| Use as default billing/shipping address | manage-address |
| Verify Your Email / Enter verification code... | login |
| Yes / No | edit-account, create-account |
| * Required fields | create-account |

*(Form input-hint values are in each form’s `.json` under `inputPlaceholders`; the table above reflects the English defaults used in JS when the key is missing.)*

---

*Generated from codebase scan of `widgets/` (compare-products, search-results, simple-search, locator, recipe-center, article-center, blender-recommender, and forms).*
