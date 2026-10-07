import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: '1rem', sm: '1.5rem', lg: '2rem' },
      screens: { '2xl': '1400px' },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        display: ['var(--font-display)', 'var(--font-sans)', 'ui-sans-serif', 'sans-serif'],
      },
      colors: {
        // Brand palette (PRD §10). `blue` and `slate` are redefined so every
        // existing screen picks up StayFlow deep indigo / blue-violet and the warm-grey charcoal neutrals
        // without touching class names; `marigold` is the warm highlight.
        // `indigo` is the same brand scale as `blue`, so either class name gives
        // the one StayFlow accent.
        blue: {
          50: '#eef0ff',
          100: '#e0e2ff',
          200: '#c7c9fe',
          300: '#a6a6fb',
          400: '#8582f6',
          500: '#6863ee',
          600: '#5248e0',
          700: '#4439c5',
          800: '#38309f',
          900: '#302c7e',
          950: '#1d1a4a',
        },
        indigo: {
          50: '#eef0ff',
          100: '#e0e2ff',
          200: '#c7c9fe',
          300: '#a6a6fb',
          400: '#8582f6',
          500: '#6863ee',
          600: '#5248e0',
          700: '#4439c5',
          800: '#38309f',
          900: '#302c7e',
          950: '#1d1a4a',
        },
        slate: {
          50: '#fafaf9',
          100: '#f4f4f2',
          200: '#e7e5e2',
          300: '#d5d2ce',
          400: '#a6a19b',
          500: '#77716b',
          600: '#57524d',
          700: '#433f3b',
          800: '#292624',
          900: '#1b1918',
          950: '#0d0c0b',
        },
        marigold: {
          50: '#fff8eb',
          100: '#feecc7',
          200: '#fdd88a',
          300: '#fcbf4d',
          400: '#fba524',
          500: '#f5850b',
          600: '#d96306',
          700: '#b44409',
          800: '#92350e',
          900: '#782d0f',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        ink: {
          50: '#f7f8fa',
          100: '#eef0f4',
          200: '#dde1e9',
          300: '#c3cad7',
          400: '#94a0b5',
          500: '#6b7a94',
          600: '#4e5c74',
          700: '#3c485c',
          800: '#2a3446',
          900: '#161d2b',
          950: '#0b101a',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'calc(var(--radius) + 4px)',
        '2xl': 'calc(var(--radius) + 8px)',
        '3xl': 'calc(var(--radius) + 16px)',
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgb(27 25 24 / 0.04)',
        card: '0 1px 2px 0 rgb(27 25 24 / 0.04)',
        elevated:
          '0 2px 4px -2px rgb(16 24 40 / 0.06), 0 12px 24px -6px rgb(16 24 40 / 0.10)',
        float: '0 8px 16px -6px rgb(16 24 40 / 0.10), 0 24px 48px -12px rgb(16 24 40 / 0.18)',
        glow: '0 0 0 1px rgb(255 255 255 / 0.06) inset, 0 10px 40px -12px rgb(82 72 224 / 0.40)',
        // Cards no longer stack a large shadow on top of the border.
        soft: '0 1px 2px 0 rgb(27 25 24 / 0.04)',
        lift: '0 2px 4px -1px rgb(27 25 24 / 0.06), 0 16px 32px -12px rgb(27 25 24 / 0.18)',
        brand: '0 1px 0 0 rgb(255 255 255 / 0.25) inset, 0 6px 16px -6px rgb(82 72 224 / 0.55), 0 2px 4px -1px rgb(82 72 224 / 0.25)',
        'inner-highlight': 'inset 0 1px 0 0 rgb(255 255 255 / 0.08)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        marquee: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'float-slow': {
          '0%, 100%': { transform: 'translate3d(0,0,0) rotate(0deg)' },
          '50%': { transform: 'translate3d(0,-14px,0) rotate(1.5deg)' },
        },
        'gradient-x': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        aurora: {
          '0%': { transform: 'translate3d(0,0,0) scale(1)' },
          '33%': { transform: 'translate3d(4%,-6%,0) scale(1.08)' },
          '66%': { transform: 'translate3d(-5%,4%,0) scale(0.96)' },
          '100%': { transform: 'translate3d(0,0,0) scale(1)' },
        },
        shine: {
          from: { transform: 'translateX(-120%) skewX(-20deg)' },
          to: { transform: 'translateX(220%) skewX(-20deg)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-5px)' },
          '40%, 80%': { transform: 'translateX(5px)' },
        },
        'pop-in': {
          from: { opacity: '0', transform: 'scale(0.92)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '70%': { transform: 'scale(1.6)', opacity: '0' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        shimmer: 'shimmer 1.8s infinite',
        'fade-up': 'fade-up 0.4s ease-out both',
        marquee: 'marquee 30s linear infinite',
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        float: 'float 6s ease-in-out infinite',
        'float-slow': 'float-slow 9s ease-in-out infinite',
        'gradient-x': 'gradient-x 8s ease infinite',
        aurora: 'aurora 18s ease-in-out infinite',
        shine: 'shine 1.1s ease-in-out',
        shake: 'shake 0.4s ease-in-out',
        'pop-in': 'pop-in 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'spin-slow': 'spin-slow 24s linear infinite',
      },
      backgroundImage: {
        'grid-light':
          'linear-gradient(to right, rgb(15 23 42 / 0.04) 1px, transparent 1px), linear-gradient(to bottom, rgb(15 23 42 / 0.04) 1px, transparent 1px)',
      },
    },
  },
  plugins: [animate],
}

export default config
