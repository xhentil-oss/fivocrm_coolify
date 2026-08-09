module.exports = {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "#ECEFF4",
        "border-strong": "#DCE3EC",
        input: "#DCE3EC",
        ring: "#0EA5E9",
        background: "#F4F6FA",
        foreground: "#0C1B33",
        // Primary action = cyan accent (buttons, links, active icons)
        primary: {
          DEFAULT: "#0EA5E9",
          foreground: "#04223A",
          hover: "#0369A1",
          active: "#025683",
        },
        // Secondary button = soft neutral surface
        secondary: {
          DEFAULT: "#EEF1F6",
          foreground: "#42506A",
          hover: "#E2E7F0",
          active: "#D8DFEA",
        },
        // Tertiary = navy brand
        tertiary: {
          DEFAULT: "#12468C",
          foreground: "#FFFFFF",
        },
        // Navy brand scale
        navy: {
          700: "#12468C",
          800: "#0C2C63",
          900: "#08183A",
        },
        // ── Dashboard surface (hifi handoffs: Financat + Projekti) ──
        // One palette for the navy-hero dashboards. Defined here, per the
        // handoff, so no page hardcodes these hexes. Status ink (pos/neg/warn)
        // means profit-vs-loss or on-track-vs-late ONLY; `blue` carries series
        // identity and action, and never implies "good".
        brand: {
          navy: "#08183A",
          "navy-mid": "#0d2a63",   // hero gradient start
          "navy-deep": "#0c2456",  // avatar tile gradient start
          blue: "#2f6fe0",
          "blue-hover": "#2258bb",
          "blue-soft": "#7fb2f4",  // secondary series
          "blue-tint": "#dbe7fb",
          ink: "#24344d",          // body text
          muted: "#7286a3",
          "muted-2": "#94a5bd",    // column heads, axis ink
          line: "#e3e9f2",         // card border
          "line-soft": "#edf1f7",  // row divider
          "line-softer": "#f4f7fb",
          surface: "#f6f9fd",      // row hover / inset panel
          board: "#e9eef6",        // kanban column ground
          chip: "#e6ebf3",
          "chip-ink": "#5b6f8d",
          pos: "#1e7a46",
          "pos-tint": "#e8f2ec",
          warn: "#d9a021",
          "warn-ink": "#8a6413",
          "warn-tint": "#fdf6e8",
          "warn-line": "#eedcb2",
          neg: "#d64545",
          "neg-ink": "#b23030",
          "neg-tint": "#fdeeee",
          "neg-line": "#f3c8c8",
        },
        // Cyan accent extras
        "accent-ink": "#0369A1",
        "accent-bright": "#38BDF8",
        "accent-soft": "#E7F6FE",
        "accent-on": "#04223A",
        // shadcn `accent` = subtle hover surface (soft cyan tint)
        accent: {
          DEFAULT: "#E7F6FE",
          foreground: "#0369A1",
        },
        // shadcn destructive (was missing) → error red
        destructive: {
          DEFAULT: "#DC2626",
          foreground: "#FFFFFF",
        },
        success: {
          DEFAULT: "#22A565",
          foreground: "#FFFFFF",
          soft: "#E7F7EF",
        },
        warning: {
          DEFAULT: "#D98A0B",
          foreground: "#FFFFFF",
          soft: "#FEF3E2",
        },
        error: {
          DEFAULT: "#DC2626",
          foreground: "#FFFFFF",
          soft: "#FDECEC",
        },
        info: {
          DEFAULT: "#0EA5E9",
          foreground: "#04223A",
        },
        muted: {
          DEFAULT: "#EEF1F6",
          foreground: "#6B7A93",
        },
        popover: {
          DEFAULT: "#FFFFFF",
          foreground: "#0C1B33",
        },
        card: {
          DEFAULT: "#FFFFFF",
          foreground: "#0C1B33",
        },
        gray: {
          50: "#F4F6FA",
          100: "#EEF1F6",
          200: "#ECEFF4",
          300: "#DCE3EC",
          400: "#8394AD",
          500: "#6B7A93",
          600: "#516078",
          700: "#3A4658",
          800: "#22303F",
          900: "#0C1B33",
        },
      },
      fontFamily: {
        sans: ['"DM Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      fontSize: {
        'h1': ['28px', { lineHeight: '36px', fontWeight: '800', letterSpacing: '-0.025em' }],
        'h2': ['24px', { lineHeight: '32px', fontWeight: '700', letterSpacing: '-0.025em' }],
        'h3': ['20px', { lineHeight: '28px', fontWeight: '700', letterSpacing: '-0.02em' }],
        'h4': ['18px', { lineHeight: '26px', fontWeight: '600', letterSpacing: '-0.02em' }],
        'body-lg': ['16px', { lineHeight: '26px', fontWeight: '300' }],
        'body': ['15px', { lineHeight: '24px', fontWeight: '300' }],
        'body-sm': ['14px', { lineHeight: '22px', fontWeight: '300' }],
        'caption': ['12px', { lineHeight: '18px', fontWeight: '300' }],
      },
      screens: {
        'xs': '375px',
      },
      spacing: {
        '1': '4px',
        '2': '8px',
        '4': '16px',
        '6': '24px',
        '8': '32px',
        '12': '48px',
        '16': '64px',
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
        full: '9999px',
      },
      boxShadow: {
        DEFAULT: '0 1px 3px rgba(12, 27, 51, 0.06)',
        sm: '0 1px 3px rgba(12, 27, 51, 0.05)',
        md: '0 4px 12px -4px rgba(12, 27, 51, 0.12)',
        lg: '0 12px 28px -12px rgba(12, 27, 51, 0.18)',
        xl: '0 16px 40px -20px rgba(12, 27, 51, 0.45)',
        card: '0 1px 3px rgba(12, 27, 51, 0.05)',
        elevated: '0 16px 40px -20px rgba(12, 27, 51, 0.45)',
        'primary': '0 8px 18px -8px #0EA5E9',
        'glow-primary': '0 0 0 3px rgba(14, 165, 233, 0.25)',
      },
      transitionDuration: {
        fast: '150ms',
        normal: '250ms',
        slow: '400ms',
      },
      transitionTimingFunction: {
        'ease-in': 'cubic-bezier(0.4, 0, 1, 1)',
        'ease-out': 'cubic-bezier(0, 0, 0.2, 1)',
        'ease-in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      backgroundImage: {
        // Cyan accent gradient — primary actions, active nav, KPI emphasis
        'gradient-primary': 'linear-gradient(150deg, #0EA5E9 0%, #0369A1 100%)',
        // Navy brand gradient — hero / login / header / brand tiles only
        'gradient-secondary': 'linear-gradient(150deg, #12468C 0%, #0C2C63 50%, #08183A 100%)',
        'brand-navy': 'linear-gradient(150deg, #12468C 0%, #0C2C63 50%, #08183A 100%)',
        'gradient-accent': 'linear-gradient(150deg, #38BDF8 0%, #0EA5E9 100%)',
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "slide-out-right": {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(100%)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "count-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "bird-enter": {
          "0%": { transform: "translateX(80px) scale(0.5)", opacity: "0" },
          "70%": { transform: "translateX(-4px) scale(1.08)", opacity: "1" },
          "100%": { transform: "translateX(0) scale(1)", opacity: "1" },
        },
        "bird-fly": {
          "0%, 100%": { transform: "translateY(0px) rotate(0deg)" },
          "30%": { transform: "translateY(-8px) rotate(-8deg)" },
          "70%": { transform: "translateY(4px) rotate(5deg)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(1)", opacity: "0.5" },
          "100%": { transform: "scale(1.8)", opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "slide-in-right": "slide-in-right 0.3s ease-out",
        "slide-out-right": "slide-out-right 0.3s ease-out",
        "fade-in": "fade-in 0.2s ease-in",
        "count-up": "count-up 0.8s ease-out",
        "bird-enter": "bird-enter 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
        "bird-fly": "bird-fly 2.5s ease-in-out infinite",
        "pulse-ring": "pulse-ring 1.8s ease-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}