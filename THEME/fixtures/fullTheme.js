'use strict';

// A complete, activation-ready theme configuration used by tests and the Postman collection.
const role = (size, weight, line, spacing, color) => ({
  fontSize: size,
  fontWeight: weight,
  fontStyle: 'normal',
  lineHeight: line,
  letterSpacing: spacing,
  color,
});

const fullTheme = () => ({
  schemaVersion: 1,
  colors: {
    primary: '#2563EB', secondary: '#7C3AED', accent: '#F59E0B',
    background: '#FFFFFF', surface: '#F8FAFC', heading: '#0F172A',
    body: '#334155', muted: '#64748B', border: '#E2E8F0',
    success: '#16A34A', warning: '#D97706', danger: '#DC2626',
  },
  backgrounds: {
    page: { type: 'solid', color: '{colors.background}' },
    section: {
      type: 'gradient',
      angle: 135,
      stops: [{ color: '{colors.surface}', position: 0 }, { color: '#FFFFFF', position: 100 }],
    },
  },
  typography: {
    headingFontFamily: 'Inter',
    bodyFontFamily: 'Inter',
    h1: role({ base: '48px', tablet: '40px', phone: '32px' }, 700, 1.2, '-0.02em', '{colors.heading}'),
    h2: role({ base: '36px', tablet: '30px', phone: '26px' }, 700, 1.25, '-0.01em', '{colors.heading}'),
    h3: role({ base: '28px', phone: '22px' }, 600, 1.3, '0px', '{colors.heading}'),
    body: role('16px', 400, 1.6, '0px', '{colors.body}'),
    small: role('14px', 400, 1.5, '0px', '{colors.muted}'),
    button: role('16px', 600, 1.2, '0.01em', '#FFFFFF'),
  },
  spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px', xxl: { base: '48px', phone: '32px' } },
  radius: { none: '0px', sm: '4px', md: '8px', lg: '16px', pill: '9999px' },
  shadows: {
    sm: { offsetX: '0px', offsetY: '1px', blur: '2px', spread: '0px', color: 'rgba(0,0,0,0.08)' },
    md: { offsetX: '0px', offsetY: '4px', blur: '12px', spread: '0px', color: 'rgba(0,0,0,0.12)' },
    lg: { offsetX: '0px', offsetY: '12px', blur: '32px', spread: '-4px', color: 'rgba(0,0,0,0.16)' },
  },
  buttons: {
    primary: {
      background: '{colors.primary}', textColor: '#FFFFFF', borderColor: '{colors.primary}',
      borderWidth: '1px', radius: '{radius.md}', paddingX: '20px', paddingY: '10px', fontWeight: 600,
    },
    secondary: {
      background: '{colors.secondary}', textColor: '#FFFFFF', borderColor: '{colors.secondary}',
      borderWidth: '1px', radius: '{radius.md}', paddingX: '20px', paddingY: '10px', fontWeight: 600,
    },
    outline: {
      background: 'transparent', textColor: '{colors.primary}', borderColor: '{colors.primary}',
      borderWidth: '2px', radius: '{radius.md}', paddingX: '20px', paddingY: '10px', fontWeight: 600,
    },
  },
  layout: {
    containerWidth: { base: '1200px', tablet: '960px', phone: '336px' },
    pagePadding: { base: '32px', phone: '16px' },
    sectionSpacing: { base: '96px', tablet: '64px', phone: '48px' },
    gridGap: { base: '24px', phone: '16px' },
  },
  responsive: {
    breakpoints: {
      phone: { maxWidth: 767 },
      tablet: { minWidth: 768, maxWidth: 1023 },
      laptop: { minWidth: 1024 },
    },
  },
});

module.exports = { fullTheme };
