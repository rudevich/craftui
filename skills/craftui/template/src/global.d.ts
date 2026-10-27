declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.css';

declare module '*.svg' {
  const url: string;
  export default url;
}

declare module '*.png' {
  const url: string;
  export default url;
}

declare module '*.jpg' {
  const url: string;
  export default url;
}

declare module '*.jpeg' {
  const url: string;
  export default url;
}

declare module '*.webp' {
  const url: string;
  export default url;
}
