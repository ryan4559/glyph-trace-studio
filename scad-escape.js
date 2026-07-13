// OpenSCAD string-literal escaping. OpenSCAD strings support \\ and \"
// escapes; without them a charset containing " or \ emits invalid SCAD
// like `if (c == """)`.
export function scadString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
