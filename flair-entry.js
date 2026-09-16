import {
  exitExpandedMode,
  getWebViewMode,
  requestExpandedMode,
} from '@devvit/web/client';
import { createFlairView } from './flair-view.js';

const root = document.querySelector('#public-view');
const view = createFlairView(root, {
  back: (event) => {
    try {
      exitExpandedMode(event);
    } catch {
      const message = document.createElement('p');
      message.setAttribute('role', 'status');
      message.textContent = 'Use Reddit’s close button to return to the post.';
      root.querySelector('.public-content').append(message);
    }
  },
});
if (getWebViewMode() === 'expanded') void view.open();
else {
  root.innerHTML =
    '<h1>Set my flair</h1><p>Open the full form to choose your flair.</p><button id="open-flair">Open flair form</button><p id="open-status" role="status"></p>';
  root.querySelector('#open-flair').addEventListener('click', (event) => {
    try {
      requestExpandedMode(event, 'flair');
    } catch {
      root.querySelector('#open-status').textContent =
        'Could not open the form. Please try again.';
    }
  });
}
