import { SVGProps } from 'react';

// Companion to empty-basket: same 240x200 stage, same ground shadow, same
// palette (pale lilac fills, --color-primary-border outlines, one saturated
// --color-primary accent), so the two read as one set. Colours are hardcoded
// hex rather than var() for the same reason they are there - an illustration
// is a fixed drawing, not a themed component.
const OpenBookIllustration = (props: SVGProps<SVGSVGElement>) => (
  <svg {...props} viewBox="0 0 240 200" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Wider and lower than the basket's shadow: the book is a wider object,
        and sized to it the book was left visibly floating above the ground. */}
    <ellipse cx="120" cy="181" rx="78" ry="9" fill="#e7eaea" />

    {/* Cover: one continuous shape under both pages, showing as a border. */}
    <path
      d="M34,74 C68,65 102,71 120,82 C138,71 172,65 204,74 L204,166 C172,157 138,163 120,174 C102,163 68,157 34,166 Z"
      fill="#e3d7f0"
      stroke="#d7b1f3"
      strokeWidth="3"
      strokeLinejoin="round"
    />

    {/* Pages, inset from the cover on both sides. */}
    <path
      d="M120,87 C102,77 74,72 42,79 L42,158 C74,151 102,156 120,166 Z"
      fill="#f0ebf4"
      stroke="#d7b1f3"
      strokeWidth="3"
      strokeLinejoin="round"
    />
    <path
      d="M120,87 C138,77 166,72 198,79 L198,158 C166,151 138,156 120,166 Z"
      fill="#f0ebf4"
      stroke="#d7b1f3"
      strokeWidth="3"
      strokeLinejoin="round"
    />

    {/* Spine: the one saturated stroke, doing the job the basket's handle does.
        Nothing else may sit on top of it - a bookmark drawn down the centre
        swallowed it, which cost the drawing its only piece of brand colour. */}
    <path d="M120,87 L120,166" stroke="#b870eb" strokeWidth="5" strokeLinecap="round" />

    {/* Lines of a recipe, following each page's curve. */}
    <path d="M52,100 C68,98 92,101 110,105" stroke="#e3d7f0" strokeWidth="4" strokeLinecap="round" />
    <path d="M52,118 C68,116 92,119 110,123" stroke="#e3d7f0" strokeWidth="4" strokeLinecap="round" />
    <path d="M52,136 C68,134 92,137 110,141" stroke="#e3d7f0" strokeWidth="4" strokeLinecap="round" />
    <path d="M130,105 C148,101 172,98 188,100" stroke="#e3d7f0" strokeWidth="4" strokeLinecap="round" />
    <path d="M130,123 C148,119 172,116 188,118" stroke="#e3d7f0" strokeWidth="4" strokeLinecap="round" />
    <path d="M130,141 C148,137 172,134 188,136" stroke="#e3d7f0" strokeWidth="4" strokeLinecap="round" />

    {/* Bookmark, tucked into the right-hand page. A lightened --claret: at full
        strength it was the darkest thing in either drawing by some distance,
        and at thumbnail size it read as a black bar. */}
    <path d="M163,75 L171,76 L171,170 L167,164 L163,171 Z" fill="#b0446a" />
  </svg>
)

export default OpenBookIllustration;
