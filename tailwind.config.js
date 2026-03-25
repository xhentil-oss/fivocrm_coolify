module.exports = {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(0, 0%, 85%)",
        input: "hsl(0, 0%, 85%)",
        ring: "hsl(210, 70%, 54%)",
        background: "hsl(0, 0%, 98%)",
        foreground: "hsl(222, 20%, 10%)",
        primary: {
          DEFAULT: "hsl(258, 80%, 55%)",
          foreground: "hsl(0, 0%, 100%)",
          hover: "hsl(258, 80%, 47%)",
          active: "hsl(258, 80%, 41%)",
        },
        secondary: {
          DEFAULT: "hsl(258, 60%, 45%)",
          foreground: "hsl(0, 0%, 100%)",
          hover: "hsl(258, 60%, 38%)",
          active: "hsl(258, 60%, 33%)",
        },
        tertiary: {
          DEFAULT: "hsl(218, 70%, 54%)",
          foreground: "hsl(0, 0%, 100%)",
        },
        accent: {
          DEFAULT: "hsl(341, 75%, 55%)",
          foreground: "hsl(0, 0%, 100%)",
        },
        success: {
          DEFAULT: "hsl(142, 50%, 44%)",
          foreground: "hsl(0, 0%, 100%)",
        },
        warning: {
          DEFAULT: "hsl(42, 100%, 47%)",
          foreground: "hsl(0, 0%, 10%)",
        },
        error: {
          DEFAULT: "hsl(0, 75%, 50%)",
          foreground: "hsl(0, 0%, 100%)",
        },
        info: {
          DEFAULT: "hsl(210, 70%, 54%)",
          foreground: "hsl(0, 0%, 100%)",
        },
        muted: {
          DEFAULT: "hsl(0, 0%, 95%)",
          foreground: "hsl(0, 0%, 40%)",
        },
        popover: {
          DEFAULT: "hsl(0, 0%, 100%)",
          foreground: "hsl(222, 20%, 10%)",
        },
        card: {
          DEFAULT: "hsl(0, 0%, 100%)",
          foreground: "hsl(222, 20%, 10%)",
        },
        gray: {
          50: "hsl(0, 0%, 98%)",
          100: "hsl(0, 0%, 95%)",
          200: "hsl(0, 0%, 90%)",
          300: "hsl(0, 0%, 80%)",
          400: "hsl(0, 0%, 67%)",
          500: "hsl(0, 0%, 54%)",
          600: "hsl(0, 0%, 40%)",
          700: "hsl(0, 0%, 27%)",
          800: "hsl(0, 0%, 15%)",
          900: "hsl(0, 0%, 9%)",
        },
      },
      fontFamily: {
        sans: ['"DM Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      fontSize: {
        'h1': ['28px', { lineHeight: '36px', fontWeight: '500', letterSpacing: '-0.025em' }],
        'h2': ['24px', { lineHeight: '32px', fontWeight: '500', letterSpacing: '-0.025em' }],
        'h3': ['20px', { lineHeight: '28px', fontWeight: '500', letterSpacing: '-0.025em' }],
        'h4': ['18px', { lineHeight: '26px', fontWeight: '500', letterSpacing: '-0.025em' }],
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
        sm: '4px',
        md: '6px',
        lg: '8px',
        full: '9999px',
      },
      boxShadow: {
        sm: '0 1px 3px hsla(0, 0%, 0%, 0.08)',
        md: '0 3px 6px hsla(0, 0%, 0%, 0.1)',
        lg: '0 6px 12px hsla(0, 0%, 0%, 0.12)',
        xl: '0 12px 24px hsla(0, 0%, 0%, 0.15)',
        'primary': '0 4px 12px hsla(258, 80%, 55%, 0.25)',
        'glow-primary': '0 0 8px hsla(258, 80%, 55%, 0.5)',
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
        'gradient-primary': 'linear-gradient(135deg, hsl(258, 80%, 55%) 0%, hsl(218, 70%, 54%) 100%)',
        'gradient-secondary': 'linear-gradient(135deg, hsl(258, 60%, 50%) 0%, hsl(258, 60%, 38%) 100%)',
        'gradient-accent': 'linear-gradient(135deg, hsl(341, 75%, 60%) 0%, hsl(218, 70%, 55%) 100%)',
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
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "slide-in-right": "slide-in-right 0.3s ease-out",
        "slide-out-right": "slide-out-right 0.3s ease-out",
        "fade-in": "fade-in 0.2s ease-in",
        "count-up": "count-up 0.8s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}