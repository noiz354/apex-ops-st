import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#F8FAFC',
        card: '#FFFFFF',
        'surface-subtle': '#F1F5F9',
        'border-subtle': '#E2E8F0',
        'border-strong': '#CBD5E1',
        muted: '#64748B',
        body: '#1E293B',
        ink: '#0F172A',
        cobalt: { DEFAULT: '#2563EB', deep: '#1E40AF', bright: '#3B82F6', tint: '#EFF6FF' },
        slate900: '#0F172A',
        pass: { DEFAULT: '#059669', bg: '#ECFDF5', ink: '#065F46', dot: '#10B981' },
        fail: { DEFAULT: '#DC2626', bg: '#FEF2F2', ink: '#991B1B', dot: '#EF4444' },
        warn: { DEFAULT: '#D97706', bg: '#FFFBEB', ink: '#92400E', dot: '#F59E0B' },
        hold: { DEFAULT: '#64748B', bg: '#F1F5F9', ink: '#334155', dot: '#94A3B8' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
        display: ['Space Grotesk', 'Inter', 'sans-serif'],
      },
      borderRadius: { sm: '4px', DEFAULT: '4px', lg: '8px', pill: '9999px' },
      boxShadow: {
        card: '0 1px 3px 0 rgba(15,23,42,0.05), 0 1px 2px -1px rgba(15,23,42,0.05)',
        pop: '0 10px 15px -3px rgba(15,23,42,0.08), 0 4px 6px -4px rgba(15,23,42,0.03)',
        modal: '0 20px 25px -5px rgba(15,23,42,0.12), 0 8px 10px -6px rgba(15,23,42,0.04)',
        hard: '0 4px 0 0 rgba(15,23,42,0.9)',
      },
      screens: {
        mobile: { max: '767px' },
        tablet: '768px',
        desktop: '1024px',
        wide: '1440px',
      },
    },
  },
  plugins: [],
};

export default config;
