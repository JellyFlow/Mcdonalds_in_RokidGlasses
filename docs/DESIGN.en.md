[简体中文](DESIGN.md) · [English](DESIGN.en.md)

# Design and interaction notes

## Editable Figma and baseline

[Open the “真机同步 · 1.5.52” Figma page](https://www.figma.com/design/SdkRT16rRIyzNJpWggXW4I/?node-id=309-3333). [Start the core-flow prototype](https://www.figma.com/proto/SdkRT16rRIyzNJpWggXW4I/?node-id=309-3334&starting-point-node-id=309%3A3334).

The editable page follows the dimensions and styles of the 1.5.52 source. This pass rechecked and updated the first three pages: “01 · 可编辑画面”, “02 · 组件与样式” and “03 · 流程总览”. A separate “真机对照 · 1.5.52” page (node-id=311-3799) contains the verified 480 × 352 Ink Mock reference screens, so visual comparison is exact even when Figma text rendering differs. Existing pages remain intact. Text, vector icons, cards and button instances remain editable; the design is not a flattened screenshot placed in a frame.

**This overview is exported from a Figma design, not captured from glasses.** Restaurant names, order IDs and price combinations are fictional design samples. Voice actions are described by annotations; prototype clicks simulate navigation only and do not perform recognition, payment or business submissions.

![Verified Ink Mock reference screens: 1.5.52 core ordering flow](images/figma-overview.png)

## Canvas and hierarchy

The native AIUI Page uses a 480 × 352 canvas. Home headings use 30/38px; ordinary headings and product names 22/30px; menu prices 24/32px; main listening hints 20/28px; secondary text 18/26px; bottom actions are 48px high. The fulfillment screen retains its actual compact listening style rather than inheriting a larger global hint size.

Geometry follows the application source and its font measurements. Existing brand vectors, fonts and matching color variables are reused. New default/focus button components are independent of the historical components. Screen copy remains Chinese; annotations and documentation are bilingual. This does not imply English speech support.

Headings and hints stay above independently scrolling lists. Names and prices have separate columns: names wrap, amounts do not. Each menu batch has up to five items numbered from `(1)`; food icons are not restored to menu cards. Restaurant cards retain full addresses, MCP distances and operating status; content outside the viewport is reached by scrolling in the application.

## Screens and evidence

| Figma screen | Alignment target | Runtime reference |
| --- | --- | --- |
| Menu home | “选点喜欢的”, pickup mode, three meal cards, prices and first-item focus | [Current menu home reference, 480 × 352](images/home-menu-device.png) |
| Fulfillment | Hint below the heading and two pickup/delivery cards | [New 1.5.52 Mock run](images/fulfillment-mock.png) |
| Restaurants | Numbering, full address, scrolling and listening hint | [New 1.5.52 Mock run](images/stores-mock.png) |
| Menu | Batch label, numbered 80px short cards, separate price column and batch action | [Isolated Ink / Mock](images/menu-mock.png) |
| Meal detail | Quantity, price, options entry and inline listening | [New 1.5.52 Mock run](images/meal-mock.png) |
| Options | Persistent checks separate from focus; real option constraints govern selection | [Isolated Ink / Mock](images/customize-mock.png) |
| Cart and empty states | Clear, latest undo and no empty-cart checkout | [Cart](images/cart-mock.png), [clear and undo](images/undo-mock.png) |
| Review | Item subtotal, one-line preferences, payable amount and one divider | [New 1.5.52 Mock calculation sample](images/review-mock.png) |
| Order status | Pickup code, centered restaurant and order ID, no detail pagination | [Redacted historical device capture, 1.5.52](images/order-device-redacted.png) |

The four new runtime images use the actual Ink runtime with an isolated Mock gateway and simulated transcripts. The review image uses a fixed single-line calculation sample whose subtotal and payable amount come from that Mock response; it is not a live restaurant quote. Figma uses its own explicitly fictional sample data.

## Voice, physical controls and prototype boundaries

Supported pages listen once on entry without hiding their content. Main hints have no background; volume bars indicate active listening, and an inactive hint explains how to retry. Figma shows a static animation frame. Recognition is limited to 15 seconds plus up to 3 seconds for a final result; it does not restart indefinitely.

Arrow keys move focus and the confirmation key activates a control. Back cancels recording first. Option checks persist independently of focus, which moves to the last chosen option. Cart actions remove an entire line, clear the cart or undo the latest removal. Empty carts hide checkout and clear actions. Review preference changes invalidate the old quote confirmation; final business writes require a physical confirmation.

Core links connect home, fulfillment, restaurants, menu, details, options, cart, review and status, with empty-cart and undo branches. The review-to-status link is a demonstration placeholder: it does not execute the real payment and reconciliation steps. Payment remains on the phone. Delivery branches outside the selected scope are annotated rather than presented as complete.

No on-canvas Back button is added. Physical desktop exit still lacks an unambiguous independent device acceptance result; prototype links, intercepted close calls and historical images cannot establish it.

## Publication and verification

Device captures, Mock runs and designs identify their sources and versions separately. Public material contains no real account, address, order ID or connection credentials. Brand and asset rights remain separate from the code license: see [third-party notices (Chinese)](../THIRD_PARTY_NOTICES.md), [verification (Chinese)](verification/VERIFICATION.md) and [provenance (Chinese)](PROVENANCE.md).
