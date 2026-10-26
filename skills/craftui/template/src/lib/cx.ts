/** Joins class names, skipping falsy values: cx(styles.root, active && styles.active, className). */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
