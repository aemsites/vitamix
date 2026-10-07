## Hotspot Authoring

Use **Hotspot (light)** for white image markers with charcoal text and borders
and a light hover/selected shadow. **Hotspot** uses charcoal markers by default.

Use a two-column **Hotspot** block table:

| Left cell | Right cell |
| --- | --- |
| Full image with alternative text | Optional introduction: eyebrow paragraph, heading, description |
| `47,9` | Bold feature title in its own paragraph, followed by a short description |
| `53,25` | Bold feature title in its own paragraph, followed by a short description |
| `54,55` | Bold feature title in its own paragraph, followed by a short description |

Add feature rows in the desired numbering order. Coordinates are the marker's
center, expressed as `x,y` percentages of the full image from its top-left corner.
Decimals and values from 0 to 100 are supported. Missing or invalid coordinates
leave the feature text visible without an image marker on production pages.
On localhost and previews with editing enabled, these features get draggable
starter markers spaced down the center of the image. 
Marker positions and copied coordinates stay relative to the full image across layouts. 
Features outside the crop have their markers clipped, but their text remains visible.

All feature titles and descriptions remain visible. Hovering, focusing, or
activating a numbered marker highlights its feature; the first feature is selected
initially. The introduction and feature list sit beside the image on desktop and
above and below it, respectively, on mobile.

For drag positioning, open a preview URL with `?edit=hotspot` and choose **Edit
Hotspots**. The editor is also available on localhost without the query parameter;
it is not available on production domains. Drag a marker to copy its percentage
coordinates, then paste them into that feature's left cell and preview the updated
content. The coordinate button can retry copying if clipboard access is denied.
Dragging does not save changes to authored content. Coordinates can be left blank
until you position the starter markers; cancelling a drag restores the previous
position.
