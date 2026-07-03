# Nonstop Auctions - Agent Instructions

This is a Next.js auction website called Nonstop Auctions.

Design direction:
- Premium black and gold auction-house UI
- Dark charcoal backgrounds
- Gold accents
- Red/orange timer states
- Off-white text
- Clean, high-end, trustworthy style
- Avoid bright marketplace colours
- Avoid childish/gamified visuals

Core concept:
Auctions do not have fixed endings. A lot continues while bidding continues. When a bid is placed, the timer extends. The auction only ends when the timer reaches zero without another valid bid.

Tech stack:
- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase for auth, database, realtime, and storage
- Cloudflare Pages for hosting
- Stripe later, not in MVP unless requested

Code rules:
- Use clear component names
- Keep auction timer logic separate from UI components
- Do not trust client-side timers for final auction results
- Server/database state must decide whether bidding is open or closed
- Use reusable components for auction cards, room cards, lot panels, timers, and bid panels

MVP priority:
1. Visual UI
2. Mock live auction flow
3. Supabase schema
4. Auth
5. Bidding logic
6. Realtime updates
7. Seller auction creation
8. Admin controls
9. Payments later
