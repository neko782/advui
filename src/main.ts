import { mount } from 'svelte';
import './app.css';
import SingleTabApp from './SingleTabApp.svelte';

const app = mount(SingleTabApp, {
  target: document.getElementById('app')!,
});

export default app;
