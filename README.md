# SmartPantry

A grocery management app that tracks what's in your pantry, reads your receipts, and tells you what to buy before you run out.

**[Live app →](https://josephb333.github.io/SmartPantry/)**

This started as a five-person team project for CSC 642 (Human-Computer Interaction) at San Francisco State University. The assignment was a high-fidelity interactive prototype — which means everything *looked* like it worked, and almost none of it was real. I'm now taking it from prototype to product, solo, one feature at a time, and documenting the process. Progress notes live in [DEVLOG.md](DEVLOG.md).

## What it does (today)

- **Home dashboard** — at-a-glance counts of what needs buying now, soon, and what's stocked, plus a "Needs Attention" list
- **Pantry** — items grouped by category (Dairy, Bakery, Pantry, Produce, Protein) with search, category filters, status cycling (In Stock → Running Low → Buy Soon → Buy Now), and manual add/delete
- **Receipt upload** — upload a receipt photo, extract the items, add them to your pantry in one tap
- **Grocery list** — auto-generated from anything running low, plus habit-based suggestions and manual extras
- **Persistence** — your pantry survives refreshes and reopens; a reset button (↺) restores the demo data

Built as a dependency-free vanilla JS single-page app: one HTML file, one stylesheet, one script.

## What's real vs. mocked

Honesty section, kept current as features ship:

| Feature | State |
|---|---|
| View routing, filters, search, status cycling | Real |
| Manual item add / delete | Real |
| List generation from pantry state | Real |
| Persistence | **Real — localStorage, shipped Aug 2026** |
| Receipt "processing" | **Real — in-browser OCR + price-anchored parsing, shipped Aug 2026** |
| Habit-based suggestions | **Mocked — hardcoded** |

## Roadmap

**Next up:**
1. ~~Persistence — pantry state survives a refresh~~ ✅ Shipped
2. ~~Real receipt scanning~~ ✅ Shipped

**Later:** real purchase-history-based suggestions, quantity tracking, PWA install so it lives on a phone home screen like it should.

## Credit

Team project by Joe Bowen, Ian Kligman, Kerry Yu, Fanta Phommachith, and Bilal Kohgadai.

My role on the team was product concept, interaction design, wireframes, and user flows (wireframes included in this repo). The prototype implementation code was written by my teammates. Everything from the roadmap forward is my work — that's the point of this repo.