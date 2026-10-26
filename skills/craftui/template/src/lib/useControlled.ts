import { useState } from 'react';

/** A value the parent may control (`value`) or leave to the component (`defaultValue`), as native inputs do. */
export function useControlled<T>(controlled: T | undefined, initial: T): [T, (next: T) => void] {
  const [own, setOwn] = useState(initial);
  const isControlled = controlled !== undefined;
  return [isControlled ? controlled : own, (next) => !isControlled && setOwn(next)];
}
