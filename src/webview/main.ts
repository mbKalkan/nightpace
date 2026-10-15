import './styles/panel.css';
import type { HostToWebviewMessage, PanelStrings } from '../shared/protocol';
import { vscode } from './vscodeApi';

const app = document.getElementById('app') as HTMLElement;

function render(strings: PanelStrings): void {
  const main = document.createElement('main');
  main.className = 'np-main';
  main.setAttribute('aria-label', strings.title);

  const title = document.createElement('h1');
  title.className = 'np-title';
  title.textContent = strings.title;

  const empty = document.createElement('p');
  empty.className = 'np-empty';
  empty.textContent = strings.empty;

  const privacy = document.createElement('p');
  privacy.className = 'np-privacy';
  privacy.textContent = strings.privacy;

  main.append(title, empty, privacy);
  app.replaceChildren(main);
}

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;
  if (message.type === 'init') {
    document.documentElement.lang = message.locale;
    render(message.strings);
  }
});

vscode.postMessage({ type: 'ready' });
