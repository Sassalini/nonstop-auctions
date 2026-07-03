import { Camera, ChevronRight, Gem, ShieldCheck, Truck, Upload } from "lucide-react";
import { InteriorShell } from "@/components/InteriorShell";

const valuationSteps = [
  {
    title: "Specialist Review",
    copy: "Category experts review images, provenance, and condition notes.",
    icon: Gem,
  },
  {
    title: "Protected Consignment",
    copy: "Reserve guidance, identity checks, and seller controls stay visible.",
    icon: ShieldCheck,
  },
  {
    title: "Auction Logistics",
    copy: "Collection, storage, photography, and insured dispatch are planned together.",
    icon: Truck,
  },
];

export default function SellPage() {
  return (
    <InteriorShell
      eyebrow="Sell With Nonstop"
      title="Consign standout pieces to a premium live room."
      description="Submit a mock valuation request and see how seller onboarding will feel once the marketplace is connected."
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <form className="rounded-lg border border-white/10 bg-auction-panel/90 p-5 shadow-glow sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-auction-ivory">Item title</span>
              <input
                placeholder="Diamond pendant necklace"
                className="h-11 w-full rounded-md border border-white/10 bg-black/35 px-3 text-sm text-auction-ivory outline-none transition placeholder:text-auction-muted focus:border-auction-gold"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-auction-ivory">Auction room</span>
              <select className="h-11 w-full rounded-md border border-white/10 bg-black/35 px-3 text-sm text-auction-ivory outline-none transition focus:border-auction-gold">
                <option>The Jewellery Room</option>
                <option>The Watch Room</option>
                <option>The Art Room</option>
                <option>The Design Room</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-auction-ivory">Estimated value</span>
              <input
                placeholder="GBP 5,000 - 8,000"
                className="h-11 w-full rounded-md border border-white/10 bg-black/35 px-3 text-sm text-auction-ivory outline-none transition placeholder:text-auction-muted focus:border-auction-gold"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-auction-ivory">Reserve preference</span>
              <select className="h-11 w-full rounded-md border border-white/10 bg-black/35 px-3 text-sm text-auction-ivory outline-none transition focus:border-auction-gold">
                <option>Recommend a reserve</option>
                <option>No reserve</option>
                <option>I have a reserve in mind</option>
              </select>
            </label>
          </div>

          <label className="mt-5 block space-y-2">
            <span className="text-sm font-medium text-auction-ivory">Condition notes</span>
            <textarea
              rows={5}
              placeholder="Add measurements, certificates, service history, repairs, or provenance."
              className="w-full resize-none rounded-md border border-white/10 bg-black/35 px-3 py-3 text-sm text-auction-ivory outline-none transition placeholder:text-auction-muted focus:border-auction-gold"
            />
          </label>

          <div className="mt-5 rounded-lg border border-dashed border-auction-gold/40 bg-black/25 p-6 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-lg border border-auction-gold/35 text-auction-gold">
              <Upload size={22} strokeWidth={1.8} />
            </div>
            <p className="mt-3 text-sm font-medium text-auction-ivory">Upload catalogue images</p>
            <p className="mt-1 text-xs text-auction-muted">
              Front, reverse, hallmark, certificate, and condition details.
            </p>
          </div>

          <button
            type="button"
            className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-auction-gold px-4 text-sm font-semibold text-black transition hover:bg-auction-goldSoft"
          >
            Request Valuation
            <ChevronRight size={18} strokeWidth={1.8} />
          </button>
        </form>

        <aside className="space-y-3">
          {valuationSteps.map((step) => {
            const Icon = step.icon;
            return (
              <section
                key={step.title}
                className="rounded-lg border border-white/10 bg-auction-panel/80 p-5"
              >
                <Icon className="text-auction-gold" size={24} strokeWidth={1.8} />
                <h2 className="mt-4 text-lg font-semibold text-auction-ivory">{step.title}</h2>
                <p className="mt-2 text-sm leading-6 text-auction-muted">{step.copy}</p>
              </section>
            );
          })}
          <section className="rounded-lg border border-auction-gold/30 bg-auction-gold/10 p-5">
            <Camera className="text-auction-gold" size={24} strokeWidth={1.8} />
            <h2 className="mt-4 text-lg font-semibold text-auction-ivory">
              Photography Standards
            </h2>
            <p className="mt-2 text-sm leading-6 text-auction-muted">
              The live-room layout is built around large, inspectable imagery, so seller media is
              treated as a first-class part of the listing.
            </p>
          </section>
        </aside>
      </div>
    </InteriorShell>
  );
}
