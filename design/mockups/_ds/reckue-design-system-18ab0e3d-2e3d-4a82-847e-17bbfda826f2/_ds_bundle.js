/* @ds-bundle: {"format":4,"namespace":"ReckueDesignSystem_18ab0e","components":[{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"},{"name":"Banner","sourcePath":"components/feedback/Banner.jsx"},{"name":"Dialog","sourcePath":"components/feedback/Dialog.jsx"},{"name":"ProgressBar","sourcePath":"components/feedback/ProgressBar.jsx"},{"name":"Spinner","sourcePath":"components/feedback/Spinner.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Tooltip","sourcePath":"components/feedback/Tooltip.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Radio","sourcePath":"components/forms/Radio.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Textarea","sourcePath":"components/forms/Textarea.jsx"},{"name":"Breadcrumb","sourcePath":"components/navigation/Breadcrumb.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"}],"sourceHashes":{"components/core/Avatar.jsx":"64424c51e9a2","components/core/Badge.jsx":"53e0b680431f","components/core/Button.jsx":"34fafad3f385","components/core/Card.jsx":"4f6136a8be0a","components/core/IconButton.jsx":"34c8ee219efc","components/core/Tag.jsx":"f1c8629b2344","components/feedback/Banner.jsx":"a2b9549848f6","components/feedback/Dialog.jsx":"acfe9bd498d0","components/feedback/ProgressBar.jsx":"a8a715b3b404","components/feedback/Spinner.jsx":"434addafd271","components/feedback/Toast.jsx":"f937cf07c01c","components/feedback/Tooltip.jsx":"f4f0bab890f6","components/forms/Checkbox.jsx":"60084a1b7cb0","components/forms/Input.jsx":"f3623fcdb98a","components/forms/Radio.jsx":"d8544b71cbd2","components/forms/Select.jsx":"d06b36e5d48d","components/forms/Switch.jsx":"39959db2b2da","components/forms/Textarea.jsx":"48e0373208ee","components/navigation/Breadcrumb.jsx":"3efa5525155f","components/navigation/Tabs.jsx":"ed84e3a8d177","ui_kits/app/App.jsx":"c5e3185430e8","ui_kits/app/Screens.jsx":"d7c88d4aa4d0","ui_kits/app/Sidebar.jsx":"762fd9c50470","ui_kits/app/TopBar.jsx":"ed57a8d78fe1","ui_kits/app/icons.jsx":"4ce4fdf5c637"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.ReckueDesignSystem_18ab0e = window.ReckueDesignSystem_18ab0e || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const sizes = {
  sm: 28,
  md: 36,
  lg: 48
};
function Avatar({
  name = '',
  src,
  size = 'md',
  style,
  ...rest
}) {
  const dim = sizes[size] || sizes.md;
  const initials = name.split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: dim,
      height: dim,
      borderRadius: '50%',
      overflow: 'hidden',
      background: 'var(--ink-800)',
      color: 'var(--white)',
      flexShrink: 0,
      font: 'var(--weight-medium) ' + Math.round(dim * 0.36) + 'px/1 var(--font-sans)',
      letterSpacing: 'var(--tracking-tight)',
      userSelect: 'none',
      ...style
    }
  }, rest), src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }) : initials || '?');
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const tones = {
  neutral: {
    background: 'var(--surface-subtle)',
    color: 'var(--text-secondary)',
    border: 'var(--border-subtle)'
  },
  accent: {
    background: 'var(--blue-50)',
    color: 'var(--blue-700)',
    border: 'var(--blue-100)'
  },
  success: {
    background: 'var(--green-100)',
    color: 'var(--green-600)',
    border: 'var(--green-100)'
  },
  warning: {
    background: 'var(--amber-100)',
    color: 'var(--amber-600)',
    border: 'var(--amber-100)'
  },
  danger: {
    background: 'var(--red-100)',
    color: 'var(--red-600)',
    border: 'var(--red-100)'
  },
  solid: {
    background: 'var(--ink-900)',
    color: 'var(--white)',
    border: 'var(--ink-900)'
  }
};
function Badge({
  children,
  tone = 'neutral',
  dot = false,
  style,
  ...rest
}) {
  const t = tones[tone] || tones.neutral;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 20,
      padding: '0 8px',
      borderRadius: 'var(--radius-full)',
      font: 'var(--weight-medium) var(--text-xs)/1 var(--font-sans)',
      letterSpacing: 'var(--tracking-tight)',
      background: t.background,
      color: t.color,
      border: '1px solid ' + t.border,
      ...style
    }
  }, rest), dot ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: 'currentColor'
    }
  }) : null, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const sizes = {
  sm: {
    height: 30,
    padding: '0 12px',
    font: 'var(--text-sm)',
    gap: 6,
    radius: 'var(--radius-sm)'
  },
  md: {
    height: 38,
    padding: '0 16px',
    font: 'var(--text-base)',
    gap: 8,
    radius: 'var(--radius-md)'
  },
  lg: {
    height: 46,
    padding: '0 22px',
    font: 'var(--text-md)',
    gap: 8,
    radius: 'var(--radius-md)'
  }
};
const variants = {
  primary: {
    base: {
      background: 'var(--accent)',
      color: 'var(--text-on-accent)',
      border: '1px solid var(--accent)'
    },
    hover: {
      background: 'var(--accent-hover)',
      borderColor: 'var(--accent-hover)'
    }
  },
  secondary: {
    base: {
      background: 'var(--surface-card)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-default)'
    },
    hover: {
      background: 'var(--surface-subtle)',
      borderColor: 'var(--border-strong)'
    }
  },
  ghost: {
    base: {
      background: 'transparent',
      color: 'var(--text-primary)',
      border: '1px solid transparent'
    },
    hover: {
      background: 'var(--surface-subtle)'
    }
  },
  danger: {
    base: {
      background: 'var(--status-danger)',
      color: 'var(--white)',
      border: '1px solid var(--status-danger)'
    },
    hover: {
      filter: 'brightness(0.93)'
    }
  }
};
function Button({
  children,
  variant = 'primary',
  size = 'md',
  iconLeft,
  iconRight,
  fullWidth = false,
  disabled = false,
  type = 'button',
  onClick,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const s = sizes[size] || sizes.md;
  const v = variants[variant] || variants.primary;
  const composed = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s.gap,
    height: s.height,
    padding: s.padding,
    font: 'var(--weight-medium) ' + s.font + '/1 var(--font-sans)',
    letterSpacing: 'var(--tracking-tight)',
    borderRadius: s.radius,
    cursor: disabled ? 'not-allowed' : 'pointer',
    width: fullWidth ? '100%' : undefined,
    whiteSpace: 'nowrap',
    userSelect: 'none',
    transition: 'background var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), filter var(--duration-fast) var(--ease-standard)',
    opacity: disabled ? 0.45 : 1,
    ...v.base,
    ...(hover && !disabled ? v.hover : null),
    ...style
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    onClick: onClick,
    style: composed,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false)
  }, rest), iconLeft ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex'
    }
  }, iconLeft) : null, children, iconRight ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex'
    }
  }, iconRight) : null);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const pads = {
  sm: 16,
  md: 20,
  lg: 28
};
function Card({
  children,
  padding = 'md',
  interactive = false,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const p = pads[padding] ?? pads.md;
  return /*#__PURE__*/React.createElement("div", _extends({
    onMouseEnter: () => interactive && setHover(true),
    onMouseLeave: () => interactive && setHover(false),
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      padding: p,
      boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-sm)',
      transition: 'box-shadow var(--duration-base) var(--ease-standard), border-color var(--duration-base) var(--ease-standard)',
      borderColor: hover ? 'var(--border-default)' : 'var(--border-subtle)',
      cursor: interactive ? 'pointer' : 'default',
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const sizes = {
  sm: 30,
  md: 38,
  lg: 46
};
function IconButton({
  children,
  size = 'md',
  variant = 'ghost',
  disabled = false,
  'aria-label': ariaLabel,
  onClick,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const dim = sizes[size] || sizes.md;
  const variants = {
    ghost: {
      background: hover ? 'var(--surface-subtle)' : 'transparent',
      color: 'var(--text-secondary)',
      border: '1px solid transparent'
    },
    outline: {
      background: hover ? 'var(--surface-subtle)' : 'var(--surface-card)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-default)'
    },
    solid: {
      background: hover ? 'var(--accent-hover)' : 'var(--accent)',
      color: 'var(--white)',
      border: '1px solid var(--accent)'
    }
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-label": ariaLabel,
    disabled: disabled,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: dim,
      height: dim,
      borderRadius: 'var(--radius-md)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      transition: 'background var(--duration-fast) var(--ease-standard)',
      ...variants[variant],
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Tag({
  children,
  onRemove,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 26,
      padding: onRemove ? '0 6px 0 10px' : '0 10px',
      borderRadius: 'var(--radius-sm)',
      font: 'var(--weight-regular) var(--text-sm)/1 var(--font-sans)',
      background: 'var(--surface-card)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-default)',
      ...style
    }
  }, rest), children, onRemove ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Remove",
    onClick: onRemove,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 16,
      height: 16,
      borderRadius: 'var(--radius-xs)',
      cursor: 'pointer',
      background: hover ? 'var(--surface-sunken)' : 'transparent',
      color: 'var(--text-muted)',
      border: 'none',
      fontSize: 13,
      lineHeight: 1
    }
  }, "\xD7") : null);
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Banner.jsx
try { (() => {
const tones = {
  info: {
    bg: 'var(--blue-50)',
    border: 'var(--blue-100)',
    accent: 'var(--blue-600)'
  },
  success: {
    bg: 'var(--green-100)',
    border: 'var(--green-100)',
    accent: 'var(--green-600)'
  },
  warning: {
    bg: 'var(--amber-100)',
    border: 'var(--amber-100)',
    accent: 'var(--amber-600)'
  },
  danger: {
    bg: 'var(--red-100)',
    border: 'var(--red-100)',
    accent: 'var(--red-600)'
  }
};
function Banner({
  title,
  children,
  tone = 'info',
  icon,
  onClose,
  style
}) {
  const t = tones[tone] || tones.info;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      padding: '12px 14px',
      borderRadius: 'var(--radius-md)',
      background: t.bg,
      border: '1px solid ' + t.border,
      ...style
    }
  }, icon ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: t.accent,
      display: 'inline-flex',
      marginTop: 1
    }
  }, icon) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, title ? /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--label)',
      color: 'var(--text-primary)'
    }
  }, title) : null, children ? /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--body-sm)',
      color: 'var(--text-secondary)',
      marginTop: title ? 2 : 0
    }
  }, children) : null), onClose ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Dismiss",
    onClick: onClose,
    style: {
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      color: 'var(--text-muted)',
      fontSize: 16,
      lineHeight: 1
    }
  }, "\xD7") : null);
}
Object.assign(__ds_scope, { Banner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Banner.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Dialog.jsx
try { (() => {
function Dialog({
  open = false,
  title,
  children,
  footer,
  onClose,
  width = 460
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
      background: 'rgba(16,18,22,0.44)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      animation: 'reckueFade var(--duration-base) var(--ease-standard)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    role: "dialog",
    "aria-modal": "true",
    style: {
      width: '100%',
      maxWidth: width,
      background: 'var(--surface-card)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-xl)',
      border: '1px solid var(--border-subtle)',
      overflow: 'hidden'
    }
  }, title ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '18px 20px',
      borderBottom: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      font: 'var(--heading-3)',
      color: 'var(--text-primary)'
    }
  }, title), /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Close",
    onClick: onClose,
    style: {
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      color: 'var(--text-muted)',
      fontSize: 20,
      lineHeight: 1,
      padding: 4
    }
  }, "\xD7")) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 20,
      font: 'var(--body)',
      color: 'var(--text-secondary)'
    }
  }, children), footer ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 8,
      padding: '14px 20px',
      borderTop: '1px solid var(--border-subtle)',
      background: 'var(--surface-subtle)'
    }
  }, footer) : null), /*#__PURE__*/React.createElement("style", null, '@keyframes reckueFade{from{opacity:0}to{opacity:1}}'));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/feedback/ProgressBar.jsx
try { (() => {
function ProgressBar({
  value = 0,
  max = 100,
  tone = 'accent',
  showLabel = false,
  style
}) {
  const pct = Math.max(0, Math.min(100, value / max * 100));
  const colors = {
    accent: 'var(--accent)',
    success: 'var(--status-success)',
    ink: 'var(--ink-800)'
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height: 6,
      borderRadius: 'var(--radius-full)',
      background: 'var(--surface-sunken)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: pct + '%',
      height: '100%',
      borderRadius: 'var(--radius-full)',
      background: colors[tone] || colors.accent,
      transition: 'width var(--duration-slow) var(--ease-out)'
    }
  })), showLabel ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--weight-medium) var(--text-xs)/1 var(--font-mono)',
      color: 'var(--text-secondary)',
      minWidth: 34,
      textAlign: 'right'
    }
  }, Math.round(pct), "%") : null);
}
Object.assign(__ds_scope, { ProgressBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/ProgressBar.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Spinner.jsx
try { (() => {
const sizes = {
  sm: 16,
  md: 22,
  lg: 32
};
function Spinner({
  size = 'md',
  color = 'var(--accent)',
  style
}) {
  const dim = sizes[size] || sizes.md;
  return /*#__PURE__*/React.createElement("span", {
    role: "status",
    "aria-label": "Loading",
    style: {
      display: 'inline-flex',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: dim,
      height: dim,
      borderRadius: '50%',
      border: Math.max(2, Math.round(dim / 9)) + 'px solid var(--border-default)',
      borderTopColor: color,
      display: 'inline-block',
      animation: 'reckueSpin 0.7s linear infinite'
    }
  }), /*#__PURE__*/React.createElement("style", null, '@keyframes reckueSpin{to{transform:rotate(360deg)}}'));
}
Object.assign(__ds_scope, { Spinner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Spinner.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
const tones = {
  neutral: {
    accent: 'var(--ink-700)',
    bg: 'var(--surface-inverse)',
    fg: 'var(--white)'
  },
  success: {
    accent: 'var(--green-600)',
    bg: 'var(--surface-card)',
    fg: 'var(--text-primary)'
  },
  danger: {
    accent: 'var(--red-600)',
    bg: 'var(--surface-card)',
    fg: 'var(--text-primary)'
  }
};
function Toast({
  title,
  description,
  tone = 'neutral',
  onClose,
  style
}) {
  const t = tones[tone] || tones.neutral;
  const dark = tone === 'neutral';
  return /*#__PURE__*/React.createElement("div", {
    role: "status",
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      minWidth: 280,
      maxWidth: 380,
      padding: '12px 14px',
      borderRadius: 'var(--radius-md)',
      background: t.bg,
      color: t.fg,
      boxShadow: 'var(--shadow-lg)',
      border: dark ? 'none' : '1px solid var(--border-subtle)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 4,
      alignSelf: 'stretch',
      borderRadius: 'var(--radius-full)',
      background: t.accent,
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, title ? /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--label)',
      color: dark ? 'var(--white)' : 'var(--text-primary)'
    }
  }, title) : null, description ? /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--body-sm)',
      color: dark ? 'var(--ink-300)' : 'var(--text-secondary)',
      marginTop: 2
    }
  }, description) : null), onClose ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Dismiss",
    onClick: onClose,
    style: {
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      color: dark ? 'var(--ink-300)' : 'var(--text-muted)',
      fontSize: 16,
      lineHeight: 1
    }
  }, "\xD7") : null);
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tooltip.jsx
try { (() => {
function Tooltip({
  children,
  label,
  placement = 'top'
}) {
  const [show, setShow] = React.useState(false);
  const pos = {
    top: {
      bottom: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      marginBottom: 8
    },
    bottom: {
      top: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      marginTop: 8
    },
    left: {
      right: '100%',
      top: '50%',
      transform: 'translateY(-50%)',
      marginRight: 8
    },
    right: {
      left: '100%',
      top: '50%',
      transform: 'translateY(-50%)',
      marginLeft: 8
    }
  };
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-flex'
    },
    onMouseEnter: () => setShow(true),
    onMouseLeave: () => setShow(false),
    onFocus: () => setShow(true),
    onBlur: () => setShow(false)
  }, children, show ? /*#__PURE__*/React.createElement("span", {
    role: "tooltip",
    style: {
      position: 'absolute',
      zIndex: 900,
      whiteSpace: 'nowrap',
      padding: '5px 8px',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--ink-900)',
      color: 'var(--white)',
      font: 'var(--weight-regular) var(--text-xs)/1.3 var(--font-sans)',
      boxShadow: 'var(--shadow-md)',
      pointerEvents: 'none',
      ...pos[placement]
    }
  }, label) : null);
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Checkbox({
  checked = false,
  indeterminate = false,
  disabled = false,
  label,
  onChange,
  style,
  ...rest
}) {
  const on = checked || indeterminate;
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 18,
      height: 18,
      borderRadius: 'var(--radius-xs)',
      flexShrink: 0,
      background: on ? 'var(--accent)' : 'var(--surface-card)',
      border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border-strong)'),
      transition: 'background var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard)',
      color: 'var(--white)'
    }
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    checked: checked,
    disabled: disabled,
    onChange: onChange,
    style: {
      position: 'absolute',
      opacity: 0,
      width: 0,
      height: 0
    }
  }, rest)), indeterminate ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: 9,
      height: 2,
      background: 'currentColor',
      borderRadius: 1
    }
  }) : checked ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: 5,
      height: 9,
      borderRight: '2px solid currentColor',
      borderBottom: '2px solid currentColor',
      transform: 'rotate(45deg) translate(-1px,-1px)'
    }
  }) : null), label ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--body-sm)',
      color: 'var(--text-primary)'
    }
  }, label) : null);
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const sizes = {
  sm: {
    height: 32,
    font: 'var(--text-sm)',
    pad: '0 10px'
  },
  md: {
    height: 38,
    font: 'var(--text-base)',
    pad: '0 12px'
  },
  lg: {
    height: 44,
    font: 'var(--text-md)',
    pad: '0 14px'
  }
};
function Input({
  size = 'md',
  invalid = false,
  disabled = false,
  iconLeft,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const s = sizes[size] || sizes.md;
  const borderColor = invalid ? 'var(--status-danger)' : focus ? 'var(--border-focus)' : 'var(--border-default)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      width: '100%'
    }
  }, iconLeft ? /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 12,
      display: 'inline-flex',
      color: 'var(--text-muted)',
      pointerEvents: 'none'
    }
  }, iconLeft) : null, /*#__PURE__*/React.createElement("input", _extends({
    disabled: disabled,
    onFocus: e => {
      setFocus(true);
      rest.onFocus && rest.onFocus(e);
    },
    onBlur: e => {
      setFocus(false);
      rest.onBlur && rest.onBlur(e);
    },
    style: {
      width: '100%',
      height: s.height,
      padding: iconLeft ? '0 12px 0 34px' : s.pad,
      font: 'var(--weight-regular) ' + s.font + '/1 var(--font-sans)',
      color: 'var(--text-primary)',
      background: disabled ? 'var(--surface-subtle)' : 'var(--surface-card)',
      border: '1px solid ' + borderColor,
      borderRadius: 'var(--radius-md)',
      outline: 'none',
      boxShadow: focus && !invalid ? 'var(--focus-ring)' : 'none',
      transition: 'border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)',
      opacity: disabled ? 0.6 : 1,
      ...style
    }
  }, rest)));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Radio.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Radio({
  checked = false,
  disabled = false,
  label,
  onChange,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 18,
      height: 18,
      borderRadius: '50%',
      flexShrink: 0,
      background: 'var(--surface-card)',
      border: '1px solid ' + (checked ? 'var(--accent)' : 'var(--border-strong)'),
      transition: 'border-color var(--duration-fast) var(--ease-standard)'
    }
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "radio",
    checked: checked,
    disabled: disabled,
    onChange: onChange,
    style: {
      position: 'absolute',
      opacity: 0,
      width: 0,
      height: 0
    }
  }, rest)), checked ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: 'var(--accent)'
    }
  }) : null), label ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--body-sm)',
      color: 'var(--text-primary)'
    }
  }, label) : null);
}
Object.assign(__ds_scope, { Radio });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Radio.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const sizes = {
  sm: {
    height: 32,
    font: 'var(--text-sm)'
  },
  md: {
    height: 38,
    font: 'var(--text-base)'
  },
  lg: {
    height: 44,
    font: 'var(--text-md)'
  }
};
function Select({
  children,
  size = 'md',
  invalid = false,
  disabled = false,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const s = sizes[size] || sizes.md;
  const borderColor = invalid ? 'var(--status-danger)' : focus ? 'var(--border-focus)' : 'var(--border-default)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width: '100%'
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    disabled: disabled,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      width: '100%',
      height: s.height,
      padding: '0 34px 0 12px',
      font: 'var(--weight-regular) ' + s.font + '/1 var(--font-sans)',
      color: 'var(--text-primary)',
      appearance: 'none',
      WebkitAppearance: 'none',
      background: disabled ? 'var(--surface-subtle)' : 'var(--surface-card)',
      border: '1px solid ' + borderColor,
      borderRadius: 'var(--radius-md)',
      outline: 'none',
      cursor: disabled ? 'not-allowed' : 'pointer',
      boxShadow: focus && !invalid ? 'var(--focus-ring)' : 'none',
      transition: 'border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)',
      opacity: disabled ? 0.6 : 1,
      ...style
    }
  }, rest), children), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      right: 12,
      top: '50%',
      transform: 'translateY(-50%)',
      pointerEvents: 'none',
      color: 'var(--text-muted)',
      fontSize: 12
    }
  }, "\u25BE"));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Switch({
  checked = false,
  disabled = false,
  label,
  onChange,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: () => !disabled && onChange && onChange({
      target: {
        checked: !checked
      }
    }),
    style: {
      position: 'relative',
      width: 36,
      height: 20,
      borderRadius: 'var(--radius-full)',
      background: checked ? 'var(--accent)' : 'var(--ink-200)',
      flexShrink: 0,
      transition: 'background var(--duration-base) var(--ease-standard)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: 2,
      left: checked ? 18 : 2,
      width: 16,
      height: 16,
      borderRadius: '50%',
      background: 'var(--white)',
      boxShadow: 'var(--shadow-sm)',
      transition: 'left var(--duration-base) var(--ease-out)'
    }
  })), label ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--body-sm)',
      color: 'var(--text-primary)'
    }
  }, label) : null, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    checked: checked,
    disabled: disabled,
    onChange: onChange,
    style: {
      position: 'absolute',
      opacity: 0,
      width: 0,
      height: 0
    }
  }, rest)));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/forms/Textarea.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Textarea({
  invalid = false,
  disabled = false,
  rows = 4,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const borderColor = invalid ? 'var(--status-danger)' : focus ? 'var(--border-focus)' : 'var(--border-default)';
  return /*#__PURE__*/React.createElement("textarea", _extends({
    rows: rows,
    disabled: disabled,
    onFocus: e => {
      setFocus(true);
      rest.onFocus && rest.onFocus(e);
    },
    onBlur: e => {
      setFocus(false);
      rest.onBlur && rest.onBlur(e);
    },
    style: {
      width: '100%',
      padding: '10px 12px',
      resize: 'vertical',
      font: 'var(--weight-regular) var(--text-base)/var(--leading-normal) var(--font-sans)',
      color: 'var(--text-primary)',
      background: disabled ? 'var(--surface-subtle)' : 'var(--surface-card)',
      border: '1px solid ' + borderColor,
      borderRadius: 'var(--radius-md)',
      outline: 'none',
      boxShadow: focus && !invalid ? 'var(--focus-ring)' : 'none',
      transition: 'border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)',
      opacity: disabled ? 0.6 : 1,
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Textarea.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Breadcrumb.jsx
try { (() => {
function Breadcrumb({
  items = [],
  style
}) {
  return /*#__PURE__*/React.createElement("nav", {
    "aria-label": "Breadcrumb",
    style: {
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 6,
      ...style
    }
  }, items.map((it, i) => {
    const last = i === items.length - 1;
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: i
    }, last ? /*#__PURE__*/React.createElement("span", {
      "aria-current": "page",
      style: {
        font: 'var(--weight-medium) var(--text-sm)/1 var(--font-sans)',
        color: 'var(--text-primary)'
      }
    }, it.label) : /*#__PURE__*/React.createElement("a", {
      href: it.href || '#',
      style: {
        font: 'var(--weight-regular) var(--text-sm)/1 var(--font-sans)',
        color: 'var(--text-secondary)',
        textDecoration: 'none'
      }
    }, it.label), !last ? /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)',
        fontSize: 12
      }
    }, "/") : null);
  }));
}
Object.assign(__ds_scope, { Breadcrumb });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Breadcrumb.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function Tabs({
  items = [],
  value,
  onChange,
  style
}) {
  const [internal, setInternal] = React.useState(items[0] && items[0].value);
  const active = value !== undefined ? value : internal;
  const select = v => {
    if (value === undefined) setInternal(v);
    onChange && onChange(v);
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 4,
      borderBottom: '1px solid var(--border-subtle)',
      ...style
    }
  }, items.map(it => {
    const on = it.value === active;
    return /*#__PURE__*/React.createElement("button", {
      key: it.value,
      type: "button",
      onClick: () => select(it.value),
      style: {
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '10px 12px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        font: 'var(--weight-medium) var(--text-sm)/1 var(--font-sans)',
        color: on ? 'var(--text-primary)' : 'var(--text-secondary)',
        transition: 'color var(--duration-fast) var(--ease-standard)'
      }
    }, it.icon ? /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'inline-flex'
      }
    }, it.icon) : null, it.label, /*#__PURE__*/React.createElement("span", {
      style: {
        position: 'absolute',
        left: 8,
        right: 8,
        bottom: -1,
        height: 2,
        borderRadius: '2px 2px 0 0',
        background: on ? 'var(--accent)' : 'transparent',
        transition: 'background var(--duration-fast) var(--ease-standard)'
      }
    }));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/App.jsx
try { (() => {
const DS_A = window.ReckueDesignSystem_18ab0e;
function App() {
  const [authed, setAuthed] = React.useState(false);
  const [route, setRoute] = React.useState('projects');
  const [project, setProject] = React.useState(null);
  const [tab, setTab] = React.useState('overview');
  const [query, setQuery] = React.useState('');
  const [newOpen, setNewOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  if (!authed) return /*#__PURE__*/React.createElement(window.LoginScreen, {
    onLogin: () => setAuthed(true)
  });
  const go = r => {
    setRoute(r);
    setProject(null);
  };
  let title = 'Projects',
    crumb = null,
    body = null,
    showNew = false;
  if (project) {
    title = project.name;
    crumb = [{
      label: 'Projects',
      href: '#'
    }, {
      label: project.name
    }];
    body = /*#__PURE__*/React.createElement(window.ProjectDetail, {
      project: project,
      tab: tab,
      onTab: setTab
    });
  } else if (route === 'projects') {
    title = 'Projects';
    showNew = true;
    body = /*#__PURE__*/React.createElement(window.ProjectsScreen, {
      query: query,
      onOpen: p => {
        setProject(p);
        setTab('overview');
      }
    });
  } else if (route === 'members') {
    title = 'Members';
    body = /*#__PURE__*/React.createElement(window.MembersScreen, null);
  } else if (route === 'settings') {
    title = 'Settings';
    body = /*#__PURE__*/React.createElement(window.SettingsScreen, null);
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      height: '100%',
      background: 'var(--surface-page)'
    }
  }, /*#__PURE__*/React.createElement(window.Sidebar, {
    route: route,
    onNavigate: go,
    onLogout: () => setAuthed(false)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      height: '100%'
    }
  }, /*#__PURE__*/React.createElement(window.TopBar, {
    title: title,
    breadcrumb: crumb,
    query: query,
    onQuery: setQuery,
    onNew: showNew ? () => setNewOpen(true) : null
  }), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      overflow: 'auto'
    }
  }, body)), /*#__PURE__*/React.createElement(DS_A.Dialog, {
    open: newOpen,
    onClose: () => setNewOpen(false),
    title: "New project",
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(DS_A.Button, {
      variant: "ghost",
      onClick: () => setNewOpen(false)
    }, "Cancel"), /*#__PURE__*/React.createElement(DS_A.Button, {
      variant: "primary",
      onClick: () => {
        setNewOpen(false);
        setName('');
      }
    }, "Create project"))
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      font: 'var(--label)',
      color: 'var(--text-secondary)',
      display: 'block',
      marginBottom: 6
    }
  }, "Project name"), /*#__PURE__*/React.createElement(DS_A.Input, {
    autoFocus: true,
    placeholder: "e.g. Q3 roadmap",
    value: name,
    onChange: e => setName(e.target.value),
    style: {
      marginBottom: 16
    }
  }), /*#__PURE__*/React.createElement("label", {
    style: {
      font: 'var(--label)',
      color: 'var(--text-secondary)',
      display: 'block',
      marginBottom: 6
    }
  }, "Team"), /*#__PURE__*/React.createElement(DS_A.Select, {
    defaultValue: "design"
  }, /*#__PURE__*/React.createElement("option", {
    value: "design"
  }, "Design"), /*#__PURE__*/React.createElement("option", {
    value: "product"
  }, "Product"), /*#__PURE__*/React.createElement("option", {
    value: "backend"
  }, "Backend"))));
}

// Exposed for the index.html entry to mount. No module-level side effects
// (this file is also seen by the DS bundler).
window.App = App;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/App.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/Screens.jsx
try { (() => {
const DS_S = window.ReckueDesignSystem_18ab0e;
const Ic = p => React.createElement(window.Icon, p);
const PROJECTS = [{
  id: 'atlas',
  name: 'Atlas rebrand',
  status: 'active',
  tone: 'success',
  progress: 72,
  members: ['Anna Petrova', 'Ivan Sokolov', 'Mia Chen'],
  updated: '2h ago',
  tag: 'Design'
}, {
  id: 'orbit',
  name: 'Orbit mobile app',
  status: 'active',
  tone: 'success',
  progress: 41,
  members: ['Ivan Sokolov', 'Leo Marsh'],
  updated: 'Yesterday',
  tag: 'Product'
}, {
  id: 'ledger',
  name: 'Ledger migration',
  status: 'review',
  tone: 'warning',
  progress: 88,
  members: ['Mia Chen', 'Anna Petrova'],
  updated: '3d ago',
  tag: 'Backend'
}, {
  id: 'signal',
  name: 'Signal research',
  status: 'draft',
  tone: 'neutral',
  progress: 12,
  members: ['Leo Marsh'],
  updated: '1w ago',
  tag: 'Research'
}];
const ACTIVITY = [{
  who: 'Ivan Sokolov',
  what: 'moved 3 tasks to In review',
  when: '2h ago'
}, {
  who: 'Mia Chen',
  what: 'commented on “Homepage hero”',
  when: '5h ago'
}, {
  who: 'Anna Petrova',
  what: 'created the milestone “Beta”',
  when: 'Yesterday'
}, {
  who: 'Leo Marsh',
  what: 'uploaded 12 assets',
  when: '2d ago'
}];

// ---------------- Login ----------------
function LoginScreen({
  onLogin
}) {
  const [email, setEmail] = React.useState('anna@reckue.com');
  const [pw, setPw] = React.useState('••••••••');
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      height: '100%',
      background: 'var(--surface-card)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: '0 0 44%',
      background: 'var(--ink-900)',
      color: '#fff',
      padding: 48,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo-white.png",
    alt: "",
    style: {
      width: 30,
      height: 30
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--weight-medium) 22px/1 var(--font-sans)',
      letterSpacing: '-0.03em'
    }
  }, "reckue", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--accent-bright)'
    }
  }, "."))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    style: {
      font: 'var(--weight-medium) 34px/1.15 var(--font-sans)',
      letterSpacing: '-0.02em',
      margin: 0
    }
  }, "Plan the work.", /*#__PURE__*/React.createElement("br", null), "Then do the work."), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--body)',
      color: 'var(--ink-300)',
      maxWidth: 320,
      marginTop: 16
    }
  }, "Projects, milestones, and people \u2014 in one calm, quiet workspace.")), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--caption)',
      color: 'var(--ink-500)'
    }
  }, "\xA9 2026 Reckue")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32
    }
  }, /*#__PURE__*/React.createElement("form", {
    style: {
      width: 320
    },
    onSubmit: e => {
      e.preventDefault();
      onLogin();
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      font: 'var(--heading-1)',
      color: 'var(--text-primary)',
      margin: '0 0 6px'
    }
  }, "Sign in"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--body-sm)',
      color: 'var(--text-secondary)',
      margin: '0 0 24px'
    }
  }, "Welcome back to your workspace."), /*#__PURE__*/React.createElement("label", {
    style: {
      font: 'var(--label)',
      color: 'var(--text-secondary)',
      display: 'block',
      marginBottom: 6
    }
  }, "Email"), /*#__PURE__*/React.createElement(DS_S.Input, {
    value: email,
    onChange: e => setEmail(e.target.value),
    style: {
      marginBottom: 16
    }
  }), /*#__PURE__*/React.createElement("label", {
    style: {
      font: 'var(--label)',
      color: 'var(--text-secondary)',
      display: 'block',
      marginBottom: 6
    }
  }, "Password"), /*#__PURE__*/React.createElement(DS_S.Input, {
    type: "password",
    value: pw,
    onChange: e => setPw(e.target.value),
    style: {
      marginBottom: 20
    }
  }), /*#__PURE__*/React.createElement(DS_S.Button, {
    variant: "primary",
    fullWidth: true,
    type: "submit"
  }, "Sign in"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--caption)',
      color: 'var(--text-muted)',
      textAlign: 'center',
      marginTop: 16
    }
  }, "Forgot password?"))));
}

// ---------------- Projects ----------------
function ProjectCard({
  p,
  onOpen
}) {
  return /*#__PURE__*/React.createElement(DS_S.Card, {
    interactive: true,
    onClick: () => onOpen(p),
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 34,
      height: 34,
      borderRadius: 'var(--radius-md)',
      background: 'var(--surface-subtle)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--text-secondary)'
    }
  }, Ic({
    name: 'folder',
    size: 18
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--weight-medium) var(--text-md)/1.2 var(--font-sans)',
      color: 'var(--text-primary)'
    }
  }, p.name), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--caption)',
      color: 'var(--text-muted)'
    }
  }, "Updated ", p.updated))), /*#__PURE__*/React.createElement(DS_S.Badge, {
    tone: p.tone,
    dot: true
  }, p.status)), /*#__PURE__*/React.createElement(DS_S.ProgressBar, {
    value: p.progress,
    showLabel: true
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex'
    }
  }, p.members.map((m, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      marginLeft: i ? -8 : 0,
      border: '2px solid var(--surface-card)',
      borderRadius: '50%',
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement(DS_S.Avatar, {
    name: m,
    size: "sm"
  })))), /*#__PURE__*/React.createElement(DS_S.Tag, null, p.tag)));
}
function ProjectsScreen({
  onOpen,
  query
}) {
  const list = PROJECTS.filter(p => p.name.toLowerCase().includes((query || '').toLowerCase()));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 28,
      display: 'flex',
      flexDirection: 'column',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement(DS_S.Banner, {
    tone: "info",
    title: "You're on the Team trial",
    icon: Ic({
      name: 'bell',
      size: 16
    })
  }, "14 days left. Upgrade any time from Settings."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: 16
    }
  }, list.map(p => /*#__PURE__*/React.createElement(ProjectCard, {
    key: p.id,
    p: p,
    onOpen: onOpen
  }))));
}

// ---------------- Project detail ----------------
function ProjectDetail({
  project,
  tab,
  onTab
}) {
  const p = project;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 28,
      display: 'flex',
      flexDirection: 'column',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement(DS_S.Tabs, {
    value: tab,
    onChange: onTab,
    items: [{
      value: 'overview',
      label: 'Overview'
    }, {
      value: 'activity',
      label: 'Activity'
    }, {
      value: 'members',
      label: 'Members'
    }]
  }), tab === 'overview' ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.6fr 1fr',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(DS_S.Card, null, /*#__PURE__*/React.createElement("h3", {
    style: {
      font: 'var(--heading-3)',
      color: 'var(--text-primary)',
      margin: '0 0 8px'
    }
  }, "About"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--body)',
      color: 'var(--text-secondary)',
      margin: 0
    }
  }, p.name, " covers the full workstream from discovery through delivery. Milestones are tracked weekly and reviewed every Friday."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement(DS_S.Tag, null, p.tag), /*#__PURE__*/React.createElement(DS_S.Badge, {
    tone: p.tone,
    dot: true
  }, p.status))), /*#__PURE__*/React.createElement(DS_S.Card, null, /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--label)',
      color: 'var(--text-secondary)',
      marginBottom: 12
    }
  }, "Progress"), /*#__PURE__*/React.createElement(DS_S.ProgressBar, {
    value: p.progress,
    showLabel: true
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      marginTop: 18,
      font: 'var(--body-sm)',
      color: 'var(--text-secondary)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Members"), /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--text-primary)'
    }
  }, p.members.length)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      marginTop: 8,
      font: 'var(--body-sm)',
      color: 'var(--text-secondary)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Last update"), /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--text-primary)'
    }
  }, p.updated)))) : null, tab === 'activity' ? /*#__PURE__*/React.createElement(DS_S.Card, {
    padding: "sm"
  }, ACTIVITY.map((a, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 8px',
      borderBottom: i < ACTIVITY.length - 1 ? '1px solid var(--border-subtle)' : 'none'
    }
  }, /*#__PURE__*/React.createElement(DS_S.Avatar, {
    name: a.who,
    size: "sm"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      font: 'var(--body-sm)',
      color: 'var(--text-secondary)'
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--text-primary)',
      fontWeight: 500
    }
  }, a.who), " ", a.what), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--caption)',
      color: 'var(--text-muted)'
    }
  }, a.when)))) : null, tab === 'members' ? /*#__PURE__*/React.createElement(MembersTable, {
    members: p.members
  }) : null);
}

// ---------------- Members ----------------
function MembersTable({
  members
}) {
  const roles = ['Owner', 'Editor', 'Viewer'];
  return /*#__PURE__*/React.createElement(DS_S.Card, {
    padding: "sm"
  }, members.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 140px 90px',
      alignItems: 'center',
      gap: 12,
      padding: '12px 8px',
      borderBottom: i < members.length - 1 ? '1px solid var(--border-subtle)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(DS_S.Avatar, {
    name: m,
    size: "sm"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--weight-medium) var(--text-sm)/1.2 var(--font-sans)',
      color: 'var(--text-primary)'
    }
  }, m), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--caption)',
      color: 'var(--text-muted)'
    }
  }, m.split(' ')[0].toLowerCase(), "@reckue.com"))), /*#__PURE__*/React.createElement(DS_S.Select, {
    size: "sm",
    defaultValue: roles[i % 3]
  }, roles.map(r => /*#__PURE__*/React.createElement("option", {
    key: r
  }, r))), /*#__PURE__*/React.createElement(DS_S.Badge, {
    tone: i === 0 ? 'accent' : 'neutral'
  }, i === 0 ? 'You' : 'Active'))));
}
function MembersScreen() {
  const all = ['Anna Petrova', 'Ivan Sokolov', 'Mia Chen', 'Leo Marsh'];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 28
    }
  }, /*#__PURE__*/React.createElement(MembersTable, {
    members: all
  }));
}

// ---------------- Settings ----------------
function SettingsScreen() {
  const [notify, setNotify] = React.useState(true);
  const [weekly, setWeekly] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 28,
      maxWidth: 640,
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(DS_S.Card, null, /*#__PURE__*/React.createElement("h3", {
    style: {
      font: 'var(--heading-3)',
      color: 'var(--text-primary)',
      margin: '0 0 16px'
    }
  }, "Workspace"), /*#__PURE__*/React.createElement("label", {
    style: {
      font: 'var(--label)',
      color: 'var(--text-secondary)',
      display: 'block',
      marginBottom: 6
    }
  }, "Name"), /*#__PURE__*/React.createElement(DS_S.Input, {
    defaultValue: "Reckue HQ",
    style: {
      marginBottom: 16
    }
  }), /*#__PURE__*/React.createElement("label", {
    style: {
      font: 'var(--label)',
      color: 'var(--text-secondary)',
      display: 'block',
      marginBottom: 6
    }
  }, "Default project visibility"), /*#__PURE__*/React.createElement(DS_S.Select, {
    defaultValue: "team"
  }, /*#__PURE__*/React.createElement("option", {
    value: "team"
  }, "Team"), /*#__PURE__*/React.createElement("option", {
    value: "private"
  }, "Private"))), /*#__PURE__*/React.createElement(DS_S.Card, null, /*#__PURE__*/React.createElement("h3", {
    style: {
      font: 'var(--heading-3)',
      color: 'var(--text-primary)',
      margin: '0 0 16px'
    }
  }, "Notifications"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(DS_S.Switch, {
    checked: notify,
    onChange: e => setNotify(e.target.checked),
    label: "Product updates"
  }), /*#__PURE__*/React.createElement(DS_S.Switch, {
    checked: weekly,
    onChange: e => setWeekly(e.target.checked),
    label: "Weekly digest email"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(DS_S.Button, {
    variant: "ghost"
  }, "Cancel"), /*#__PURE__*/React.createElement(DS_S.Button, {
    variant: "primary"
  }, "Save changes")));
}
Object.assign(window, {
  LoginScreen,
  ProjectsScreen,
  ProjectDetail,
  MembersScreen,
  SettingsScreen,
  RECKUE_PROJECTS: PROJECTS
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/Screens.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/Sidebar.jsx
try { (() => {
// Reckue app — dark ink sidebar with brand mark + primary nav.
const DS = window.ReckueDesignSystem_18ab0e;
function NavItem({
  icon,
  label,
  active,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      width: '100%',
      padding: '9px 12px',
      border: 'none',
      cursor: 'pointer',
      textAlign: 'left',
      borderRadius: 'var(--radius-md)',
      font: 'var(--weight-medium) var(--text-sm)/1 var(--font-sans)',
      color: active ? '#fff' : 'var(--ink-300)',
      background: active ? 'rgba(255,255,255,0.08)' : hover ? 'rgba(255,255,255,0.04)' : 'transparent',
      transition: 'background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: active ? 'var(--accent-bright)' : 'var(--ink-400)',
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement(window.Icon, {
    name: icon,
    size: 18
  })), label);
}
function Sidebar({
  route,
  onNavigate,
  onLogout
}) {
  const nav = [{
    key: 'projects',
    icon: 'grid',
    label: 'Projects'
  }, {
    key: 'members',
    icon: 'users',
    label: 'Members'
  }, {
    key: 'settings',
    icon: 'settings',
    label: 'Settings'
  }];
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      width: 232,
      flexShrink: 0,
      background: 'var(--ink-900)',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      padding: 16,
      boxSizing: 'border-box'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '4px 8px 20px'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo-white.png",
    alt: "",
    style: {
      width: 26,
      height: 26
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--weight-medium) 20px/1 var(--font-sans)',
      letterSpacing: '-0.03em',
      color: '#fff'
    }
  }, "reckue", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--accent-bright)'
    }
  }, "."))), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, nav.map(n => /*#__PURE__*/React.createElement(NavItem, {
    key: n.key,
    icon: n.icon,
    label: n.label,
    active: route === n.key,
    onClick: () => onNavigate(n.key)
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'auto',
      paddingTop: 16,
      borderTop: '1px solid rgba(255,255,255,0.08)',
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(DS.Avatar, {
    name: "Anna Petrova",
    size: "sm"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--weight-medium) var(--text-sm)/1.2 var(--font-sans)',
      color: '#fff',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, "Anna Petrova"), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--caption)',
      color: 'var(--ink-400)'
    }
  }, "Owner")), /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Log out",
    onClick: onLogout,
    style: {
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      color: 'var(--ink-400)',
      display: 'inline-flex',
      padding: 4
    }
  }, /*#__PURE__*/React.createElement(window.Icon, {
    name: "logout",
    size: 16
  }))));
}
window.Sidebar = Sidebar;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/Sidebar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/TopBar.jsx
try { (() => {
// Reckue app — top bar with contextual title, search, and primary action.
const DS_TB = window.ReckueDesignSystem_18ab0e;
function TopBar({
  title,
  breadcrumb,
  onNew,
  query,
  onQuery
}) {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      height: 64,
      flexShrink: 0,
      padding: '0 28px',
      background: 'var(--surface-card)',
      borderBottom: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, breadcrumb ? /*#__PURE__*/React.createElement(DS_TB.Breadcrumb, {
    items: breadcrumb
  }) : null, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: breadcrumb ? '4px 0 0' : 0,
      font: 'var(--heading-2)',
      color: 'var(--text-primary)'
    }
  }, title)), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 240
    }
  }, /*#__PURE__*/React.createElement(DS_TB.Input, {
    size: "sm",
    placeholder: "Search\u2026",
    value: query,
    onChange: e => onQuery(e.target.value),
    iconLeft: /*#__PURE__*/React.createElement(window.Icon, {
      name: "search",
      size: 15
    })
  })), /*#__PURE__*/React.createElement(DS_TB.IconButton, {
    "aria-label": "Notifications",
    variant: "outline"
  }, /*#__PURE__*/React.createElement(window.Icon, {
    name: "bell",
    size: 17
  })), onNew ? /*#__PURE__*/React.createElement(DS_TB.Button, {
    variant: "primary",
    iconLeft: /*#__PURE__*/React.createElement(window.Icon, {
      name: "plus",
      size: 16
    }),
    onClick: onNew
  }, "New project") : null);
}
window.TopBar = TopBar;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/TopBar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/icons.jsx
try { (() => {
// Lucide icon subset (substitution — see readme Iconography). Outline, currentColor.
const RECKUE_ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  settings: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/>'
};
function Icon({
  name,
  size = 16,
  color = 'currentColor',
  style
}) {
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      display: 'block',
      flexShrink: 0,
      ...style
    },
    dangerouslySetInnerHTML: {
      __html: RECKUE_ICON_PATHS[name] || ''
    }
  });
}
window.Icon = Icon;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/icons.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.Banner = __ds_scope.Banner;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.ProgressBar = __ds_scope.ProgressBar;

__ds_ns.Spinner = __ds_scope.Spinner;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Radio = __ds_scope.Radio;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Textarea = __ds_scope.Textarea;

__ds_ns.Breadcrumb = __ds_scope.Breadcrumb;

__ds_ns.Tabs = __ds_scope.Tabs;

})();
