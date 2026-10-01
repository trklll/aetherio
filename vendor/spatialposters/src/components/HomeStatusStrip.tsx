"use client"

import { usePSelector } from "@/lib/context"

export function HomeStatusStrip() {
  const router = usePSelector((v) => v.router)

  return (
    <footer className="w-full mt-12 md:mt-16 pb-12 px-4 sm:px-6 relative z-10" data-testid="home-status">
      {/* Floating Glass Container with clean rounded-3xl corners matching site style */}
      <div className="max-w-5xl mx-auto p-6 sm:p-10 md:p-12 rounded-3xl bg-zinc-900/60 border border-white/10 backdrop-blur-xl shadow-2xl hover:border-white/20 transition-all duration-300 relative overflow-hidden flex flex-col items-center text-center gap-6 md:gap-8 group">
        
        {/* Soft Ambient Background Glows */}
        <div className="absolute -top-24 -left-24 w-60 h-60 bg-amber-500/10 blur-[100px] rounded-full pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-60 h-60 bg-purple-500/10 blur-[100px] rounded-full pointer-events-none" />

        {/* Brand Logo */}
        <div className="flex items-center justify-center relative z-10">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo local */}
          <img
            src="/SpatialPosters.png"
            alt="SpatialPosters"
            className="h-9 md:h-11 w-auto cursor-pointer hover:scale-105 hover:brightness-110 transition-all duration-300"
            onClick={() => router.push("edit")}
          />
        </div>

        {/* Description */}
        <p className="text-xs md:text-sm text-zinc-400 max-w-lg leading-relaxed relative z-10">
          Elevating your Stremio media experience with high-definition dynamic posters, vector logos, rating badges, and real-time custom catalog integration.
        </p>

        {/* Social Action Glow Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-4 pt-1 relative z-10">

          {/* Star on GitHub Glow Button */}
          <a
            href="https://github.com/TheAceOfficials/SpatialPosters"
            target="_blank"
            rel="noopener noreferrer"
            className="group/btn relative bg-white/10 rounded-full p-px overflow-hidden shadow-xl hover:scale-105 active:scale-95 transition-all duration-300"
          >
            <span className="inset-0 absolute pointer-events-none select-none animate-glow-translate">
              <span
                className="block z-0 h-full w-14 blur-xl -translate-x-1/2 rounded-full animate-glow-scale"
                style={{
                  background: "linear-gradient(135deg, rgb(122, 105, 249), rgb(242, 99, 120), rgb(245, 131, 63))",
                }}
              />
            </span>
            <span className="flex items-center justify-center gap-2 relative z-[1] bg-zinc-950/90 rounded-full py-2.5 px-5 w-full backdrop-blur-md">
              <span className="relative group-hover/btn:scale-110 transition-transform duration-500">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="animate-star-rotate"
                >
                  <path
                    d="M11.5268 2.29489C11.5706 2.20635 11.6383 2.13183 11.7223 2.07972C11.8062 2.02761 11.903 2 12.0018 2C12.1006 2 12.1974 2.02761 12.2813 2.07972C12.3653 2.13183 12.433 2.20635 12.4768 2.29489L14.7868 6.97389C14.939 7.28186 15.1636 7.5483 15.4414 7.75035C15.7192 7.95239 16.0419 8.08401 16.3818 8.13389L21.5478 8.88989C21.6457 8.90408 21.7376 8.94537 21.8133 9.00909C21.8889 9.07282 21.9452 9.15644 21.9758 9.2505C22.0064 9.34456 22.0101 9.4453 21.9864 9.54133C21.9627 9.63736 21.9126 9.72485 21.8418 9.79389L18.1058 13.4319C17.8594 13.672 17.6751 13.9684 17.5686 14.2955C17.4622 14.6227 17.4369 14.9708 17.4948 15.3099L18.3768 20.4499C18.3941 20.5477 18.3835 20.6485 18.3463 20.7406C18.3091 20.8327 18.2467 20.9125 18.1663 20.9709C18.086 21.0293 17.9908 21.0639 17.8917 21.0708C17.7926 21.0777 17.6935 21.0566 17.6058 21.0099L12.9878 18.5819C12.6835 18.4221 12.345 18.3386 12.0013 18.3386C11.6576 18.3386 11.3191 18.4221 11.0148 18.5819L6.3978 21.0099C6.31013 21.0563 6.2112 21.0772 6.11225 21.0701C6.0133 21.0631 5.91832 21.0285 5.83809 20.9701C5.75787 20.9118 5.69563 20.8321 5.65846 20.7401C5.62128 20.6482 5.61066 20.5476 5.6278 20.4499L6.5088 15.3109C6.567 14.9716 6.54178 14.6233 6.43534 14.2959C6.32889 13.9686 6.14441 13.672 5.8978 13.4319L2.1618 9.79489C2.09039 9.72593 2.03979 9.63829 2.01576 9.54197C1.99173 9.44565 1.99524 9.34451 2.02588 9.25008C2.05652 9.15566 2.11307 9.07174 2.18908 9.00788C2.26509 8.94402 2.3575 8.90279 2.4558 8.88889L7.6208 8.13389C7.96106 8.08439 8.28419 7.95295 8.56238 7.75088C8.84058 7.54881 9.0655 7.28216 9.2178 6.97389L11.5268 2.29489Z"
                    fill="url(#star_grad_1)"
                    stroke="url(#star_grad_1)"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <defs>
                    <linearGradient id="star_grad_1" x1="-0.5" y1="9" x2="15.5" y2="-1.5" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#7A69F9" />
                      <stop offset="0.575" stopColor="#F26378" />
                      <stop offset="1" stopColor="#F5833F" />
                    </linearGradient>
                  </defs>
                </svg>
                <span
                  className="rounded-full size-10 absolute opacity-30 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 blur-md pointer-events-none animate-star-shine"
                  style={{
                    background: "linear-gradient(135deg, rgb(59, 196, 242), rgb(122, 105, 249), rgb(242, 99, 120), rgb(245, 131, 63))",
                  }}
                />
              </span>
              <span className="bg-gradient-to-r from-white via-zinc-100 to-zinc-400 bg-clip-text text-xs sm:text-sm font-semibold text-transparent group-hover/btn:scale-105 transition-transform duration-300">
                Star on GitHub
              </span>
            </span>
          </a>

          {/* Follow on Instagram Glow Button */}
          <a
            href="https://instagram.com/TheAceOfficials"
            target="_blank"
            rel="noopener noreferrer"
            className="group/btn relative bg-white/10 rounded-full p-px overflow-hidden shadow-xl hover:scale-105 active:scale-95 transition-all duration-300"
          >
            <span className="inset-0 absolute pointer-events-none select-none animate-glow-translate">
              <span
                className="block z-0 h-full w-14 blur-xl -translate-x-1/2 rounded-full animate-glow-scale"
                style={{
                  background: "linear-gradient(135deg, rgb(131, 58, 180), rgb(253, 29, 29), rgb(252, 176, 69))",
                }}
              />
            </span>
            <span className="flex items-center justify-center gap-2 relative z-[1] bg-zinc-950/90 rounded-full py-2.5 px-5 w-full backdrop-blur-md">
              <span className="relative group-hover/btn:scale-110 transition-transform duration-500">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="animate-star-rotate"
                >
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5" stroke="url(#insta_grad_1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" stroke="url(#insta_grad_1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" stroke="url(#insta_grad_1)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  <defs>
                    <linearGradient id="insta_grad_1" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#833AB4" />
                      <stop offset="0.5" stopColor="#FD1D1D" />
                      <stop offset="1" stopColor="#FCB045" />
                    </linearGradient>
                  </defs>
                </svg>
                <span
                  className="rounded-full size-10 absolute opacity-30 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 blur-md pointer-events-none animate-star-shine"
                  style={{
                    background: "linear-gradient(135deg, rgb(131, 58, 180), rgb(253, 29, 29), rgb(252, 176, 69))",
                  }}
                />
              </span>
              <span className="bg-gradient-to-r from-white via-zinc-100 to-zinc-400 bg-clip-text text-xs sm:text-sm font-semibold text-transparent group-hover/btn:scale-105 transition-transform duration-300">
                Instagram
              </span>
            </span>
          </a>

        </div>

        {/* Minimal Copyright */}
        <div className="pt-6 border-t border-white/5 w-full flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-zinc-500 relative z-10">
          <p>© {new Date().getFullYear()} SpatialPosters. All rights reserved.</p>
          <p className="text-[10px] text-zinc-600">Open-source media enhancement project for Stremio</p>
        </div>

      </div>
    </footer>
  )
}
