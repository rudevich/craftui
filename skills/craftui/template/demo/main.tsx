import { createRoot } from 'react-dom/client';
import '../src/tokens.css';
import './fonts';
import './demo.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
