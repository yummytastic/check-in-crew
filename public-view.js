import { createFlairView } from './flair-view.js';
import {
  activityLevels,
  calculate,
  poundsToKg,
  kgToPounds,
  stoneToKg,
  kgToStone,
  imperialToCm,
  cmToImperial,
} from './src/tools/calculator.ts';

// Measurements live only in this closure. Never pass them to access checks or links.
export function createPublicView(
  root,
  { checkAccess, openDashboard, openFlair = () => false, navigate }
) {
  let access = 'checking';
  let flairEnabled = false;
  let dashboardOpening = false;
  let flairFrom = 'home';
  const flairView = createFlairView(root, { back: () => go(flairFrom) });
  let enabled = false;
  let optionsLoaded = false;
  let publicFailed = false;
  let community = '';
  let view = 'home';
  let calculatorMode = 'calories';
  let helpFrom = 'home';
  let helpTab = 'basics';
  let heightUnits = 'cm';
  let weightUnits = 'kg';
  let heightCm = NaN,
    weightKg = NaN;
  const values = {
    age: '',
    sex: '',
    activity: '',
    height: '',
    feet: '',
    inches: '',
    weight: '',
    stone: '',
    pounds: '',
  };
  let result;
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c]
    );
  const num = (value) => (value.trim() === '' ? NaN : Number(value));
  const textNumber = (value) =>
    Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : '';
  const button = (id, label, secondary = false) =>
    `<button type="button" id="${id}"${secondary ? ' class="secondary"' : ''}>${label}</button>`;
  const sources = [
    ['Mifflin–St Jeor study', 'https://pubmed.ncbi.nlm.nih.gov/2305711/'],
    [
      'Activity factors (Q&A, p. 1)',
      'https://healthcare.orgain.com/media/webinar/qa/MakingGoodAthletesGreatQ_A.pdf',
    ],
    [
      'BMI formula (CDC)',
      'https://www.cdc.gov/growth-chart-training/hcp/using-bmi/body-mass-index.html',
    ],
  ];
  function go(next) {
    view = next;
    render();
    root.querySelector('h1, h2')?.focus({ preventScroll: true });
  }
  function help() {
    helpFrom = view;
    helpTab = 'basics';
    go('help');
  }
  function input(name, label, mode = 'decimal') {
    return `<label>${label}<input id="calc-${name}" data-calc="${name}" value="${esc(values[name])}" inputmode="${mode}" type="text" autocomplete="off" spellcheck="false" aria-describedby="error-${name}"><span class="field-error" id="error-${name}" hidden></span></label>`;
  }
  function select(name, label, options) {
    return `<label>${label}<select id="calc-${name}" data-calc="${name}" aria-describedby="error-${name}"><option value="">Choose…</option>${options.map(([id, text]) => `<option value="${id}"${values[name] === id ? ' selected' : ''}>${text}</option>`).join('')}</select><span class="field-error" id="error-${name}" hidden></span></label>`;
  }
  function activityDescription() {
    return (
      activityLevels.find((level) => level.id === values.activity)
        ?.description ??
      'Choose your usual whole-day activity. A short workout does not cancel out a mostly seated day.'
    );
  }
  function render() {
    if (view === 'flair') return;
    let heading, content, footer;
    if (dashboardOpening) {
      heading = 'Check-In Crew';
      content = '<p role="status">Opening dashboard…</p>';
      footer = '';
      root.innerHTML = `<div class="public-screen" data-public-screen="opening-dashboard"><h1 tabindex="-1">${heading}</h1><div class="public-content">${content}</div><div class="public-footer">${footer}</div></div>`;
      return;
    }
    if (view === 'home') {
      heading = 'Check-In Crew';
      const accessMessage = {
        checking: 'Checking existing access…',
        'signed-out':
          'Sign in to Reddit with your assigned account, then check your access.',
        unassigned:
          'If you’ve arranged to help, ask a moderator to assign your account.',
        failed: 'Could not check access. Please retry.',
        authorised: 'Your account has management access.',
      }[access];
      const communityLabel = community ? `/r/${esc(community)}` : 'This community';
      const modmail = community
        ? `<a href="https://www.reddit.com/message/compose?to=%2Fr%2F${encodeURIComponent(community)}">message the moderators</a>`
        : 'message the moderators';
      const introduction =
        access === 'authorised'
          ? `${communityLabel}'s community tools and volunteer dashboard. You have access to the dashboard; use the button at the bottom of the page to open it. If you need to contact the moderators, please ${modmail}.`
          : `${communityLabel}'s community tools and volunteer dashboard. Please feel free to use the available tools below. If you have questions or would like to volunteer to run a regular themed thread, please ${modmail}.`;
      content = `<p>${introduction}</p>${enabled ? `<section class="public-tools"><h2>Community tools</h2>${button('open-bmi', 'BMI calculator')}${button('open-calculator', 'TDEE calculator')}${flairEnabled ? button('public-set-flair', 'Set flair') : ''}</section>` : ''}${publicFailed ? '<p>Community tools could not be loaded. Try checking again.</p>' : ''}${access === 'authorised' ? '' : `<p id="public-access-status" class="public-muted" role="status">${accessMessage}</p>`}`;
      const management =
        access === 'authorised'
          ? button('public-open-dashboard', 'Open dashboard', true)
          : button(
              'public-check-access',
              access === 'failed' ? 'Retry access check' : 'Check my access',
              true
            );
      footer = button('public-about', 'About Check-In Crew', true) + management;
    } else if (view === 'about') {
      heading = 'About Check-In Crew';
      content = '<p>Check-In Crew helps moderators and volunteer hosts run scheduled community check-ins and recurring posts.</p><p>You can use the available calculator and flair tools. If you have questions or need management access, contact the community moderators through modmail.</p>';
      footer = button('about-back', 'Back', true);
    } else if (view === 'inputs') {
      heading = calculatorMode === 'bmi' ? 'BMI calculator' : 'Calorie needs calculator';
      const calorieFields = calculatorMode === 'bmi' ? '' : `${input('age', 'Age (18+)', 'numeric')}${select(
        'sex',
        'Sex used by formula',
        [
          ['female', 'Female'],
          ['male', 'Male'],
        ]
      )}`;
      content = `<form id="calculator-form" novalidate autocomplete="off"><div class="calculator-grid">${calorieFields}<div class="measurement-group"><label><span class="unit-label">Height units</span><select id="calc-height-units"><option value="cm"${heightUnits === 'cm' ? ' selected' : ''}>Centimetres</option><option value="ft"${heightUnits === 'ft' ? ' selected' : ''}>Feet &amp; inches</option></select></label>${heightUnits === 'cm' ? input('height', 'Height (cm)') : `<div class="split-measurement">${input('feet', 'Feet', 'numeric')}${input('inches', 'Inches')}</div>`}</div><div class="measurement-group"><label><span class="unit-label">Weight units</span><select id="calc-weight-units">${[
        ['kg', 'Kilograms'],
        ['lb', 'Pounds'],
        ['st', 'Stone & pounds'],
      ]
        .map(
          ([id, label]) =>
            `<option value="${id}"${weightUnits === id ? ' selected' : ''}>${label}</option>`
        )
        .join(
          ''
      )}</select></label>${weightUnits === 'st' ? `<div class="split-measurement">${input('stone', 'Stone', 'numeric')}${input('pounds', 'Pounds')}</div>` : input('weight', weightUnits === 'kg' ? 'Weight (kg)' : 'Weight (lb)')}</div>${calculatorMode === 'bmi' ? '' : `<div class="activity-field">${select(
        'activity',
        'Activity level',
        activityLevels.map((level) => [level.id, level.label])
      )}</div>`}<p id="activity-description" class="public-muted">${calculatorMode === 'bmi' ? 'BMI is an adult screening measure, not a diagnosis.' : esc(activityDescription())}</p></div></form><div class="calculator-help-row"><button type="button" class="link-button" id="calculation-help">About this calculation</button><span class="public-privacy" title="Details stay on this device and aren’t saved.">Details aren’t saved.</span></div>`;
      footer =
        '<button type="submit" form="calculator-form" id="calculator-submit">Calculate</button>' +
        button('calculator-back', 'Back', true) +
        (access === 'authorised'
          ? button('public-open-dashboard', 'Open dashboard', true)
          : button('calculator-access', 'About Check-In Crew', true));
    } else if (view === 'results') {
      heading = 'Your estimate';
      content = calculatorMode === 'bmi' ? `<section class="calculator-result"><h2>BMI estimate</h2><p class="result-value">${esc(result.bmi)}</p><p>BMI is a screening measure, not a diagnosis.</p></section><button type="button" class="link-button" id="calculation-help">How this is calculated</button>` : `<section class="calculator-result"><h2>Estimated daily calorie needs</h2><p class="result-value">${esc(result.kcal.toLocaleString('en'))} <span>kcal/day</span></p><p>Estimated calories to maintain your current weight.</p></section><section class="calculator-result"><h2>BMI</h2><p class="result-value">${esc(result.bmi)}</p></section><p class="public-muted">Calorie needs are estimates; individual needs vary.</p><button type="button" class="link-button" id="calculation-help">How this is calculated</button>`;
      footer =
        button('calculator-edit', 'Edit details') +
        button('calculator-home', 'Back to home', true);
    } else {
      heading = 'About this calculation';
      const pages = {
        basics:
          '<p><strong>Daily needs:</strong> estimated energy to maintain your current weight, including everyday movement and exercise.</p><p>Mifflin–St Jeor estimates resting energy. Your activity choice multiplies it by 1.2, 1.375, 1.55, 1.725 or 1.9. These are broad approximations; more activity raises the estimate.</p><p><strong>BMI:</strong> weight in kg ÷ height in metres squared. It does not measure body fat or determine health, and is not used in the calorie formula.</p>',
        activity:
          '<p>These are rough guides to total daily movement, work and purposeful exercise, not a score for workout frequency alone. A short session does not cancel out a mostly seated day.</p><p>Very active and extremely active are for sustained high workloads, including demanding athletic lifestyles. Select them only when your usual routine fits; they are not a shortcut to a higher calorie estimate.</p><p>Every result estimates maintenance, not a weight-loss target. Being in a calorie deficit does not determine your activity level.</p>',
        formula:
          '<p><strong>Mifflin–St Jeor:</strong> 10 × kg + 6.25 × cm − 5 × age, then +5 (male) or −161 (female), estimates resting kcal/day. Multiply by activity for daily needs.</p><p><strong>Sex input:</strong> the study used female and male groups with different constants. This is a formula choice, not a gender label; it may not reflect your physiology or hormone treatment.</p>',
        limits: `<p>For adults 18+. Not designed for pregnancy, breastfeeding or clinical nutrition. Body composition, health and age can affect accuracy; the original study included ages 19–78.</p><p>Measurements and results stay in memory on this device and disappear when the app reloads. Source links contain none of your details.</p><nav aria-label="Calculation sources">${sources.map(([label, url]) => `<button type="button" class="link-button" data-source="${url}">${label}</button>`).join('')}</nav>`,
      };
      content = `<nav class="help-tabs" aria-label="Help topics">${[
        ['basics', 'Overview'],
        ['activity', 'Activity'],
        ['formula', 'Formula & sex'],
        ['limits', 'Limits & sources'],
      ]
        .map(
          ([id, label]) =>
            `<button class="secondary" type="button" data-help-tab="${id}" aria-pressed="${helpTab === id}">${label}</button>`
        )
        .join('')}</nav><div class="calculation-help">${pages[helpTab]}</div>`;
      footer = button('calculator-help-back', 'Back', true);
    }
    root.innerHTML = `<div class="public-screen" data-public-screen="${view}"><h1 tabindex="-1">${heading}</h1><div class="public-content">${content}</div><div class="public-footer">${footer}</div></div>`;
    const bind = (id, action) =>
      root.querySelector('#' + id)?.addEventListener('click', action);
    bind('open-bmi', () => {
      calculatorMode = 'bmi';
      go('inputs');
    });
    bind('open-calculator', () => {
      calculatorMode = 'calories';
      go('inputs');
    });
    bind('public-about', () => go('about'));
    bind('about-back', () => go('home'));
    bind('public-set-flair', (event) => {
      try {
        if (openFlair(event)) return;
      } catch {
        let error = root.querySelector('#flair-open-error');
        if (!error) {
          error = document.createElement('p');
          error.id = 'flair-open-error';
          error.setAttribute('role', 'alert');
          root.querySelector('.public-content').append(error);
        }
        error.textContent =
          'Could not open the full flair form. Please try again.';
        return;
      }
      flairFrom = view;
      view = 'flair';
      void flairView.open();
    });
    bind('public-community', () =>
      navigate(`https://www.reddit.com/r/${encodeURIComponent(community)}/`)
    );
    bind('public-check-access', () => {
      void checkAccess();
    });
    bind('public-open-dashboard', openDashboard);
    if (root.querySelector('#public-check-access'))
      root.querySelector('#public-check-access').disabled =
        access === 'checking';
    bind('calculator-back', () => go('home'));
    bind('calculator-access', () => go('home'));
    bind('calculator-home', () => go('home'));
    bind('calculator-edit', () => go('inputs'));
    bind('calculation-help', help);
    bind('calculator-help-back', () => go(helpFrom));
    root
      .querySelectorAll('[data-source]')
      .forEach((link) =>
        link.addEventListener('click', () => navigate(link.dataset.source))
      );
    root.querySelectorAll('[data-help-tab]').forEach((tab) =>
      tab.addEventListener('click', () => {
        helpTab = tab.dataset.helpTab;
        render();
        root
          .querySelector(`[data-help-tab="${helpTab}"]`)
          .focus({ preventScroll: true });
      })
    );
    if (view === 'inputs') bindInputs();
  }
  function heightPartsValid() {
    return (
      Number.isInteger(num(values.feet)) &&
      num(values.feet) >= 0 &&
      Number.isFinite(num(values.inches)) &&
      num(values.inches) >= 0 &&
      num(values.inches) < 12
    );
  }
  function weightPartsValid() {
    return (
      Number.isInteger(num(values.stone)) &&
      num(values.stone) >= 0 &&
      Number.isFinite(num(values.pounds)) &&
      num(values.pounds) >= 0 &&
      num(values.pounds) < 14
    );
  }
  function updateMeasurements(name) {
    if (['weight', 'stone', 'pounds'].includes(name))
      weightKg =
        weightUnits === 'kg'
          ? num(values.weight)
          : weightUnits === 'lb'
            ? poundsToKg(num(values.weight))
            : stoneToKg(num(values.stone), num(values.pounds));
    if (['height', 'feet', 'inches'].includes(name))
      heightCm =
        heightUnits === 'cm'
          ? num(values.height)
          : imperialToCm(num(values.feet), num(values.inches));
  }
  function bindInputs() {
    root.querySelectorAll('[data-calc]').forEach((field) => {
      field.addEventListener('input', () => {
        values[field.dataset.calc] = field.value;
        updateMeasurements(field.dataset.calc);
        field.removeAttribute('aria-invalid');
        root.querySelector('#error-' + field.dataset.calc).hidden = true;
        if (field.dataset.calc === 'activity')
          root.querySelector('#activity-description').textContent =
            activityDescription();
      });
    });
    root
      .querySelector('#calc-height-units')
      .addEventListener('change', (event) => {
        const entered =
          heightUnits === 'cm' ? values.height : values.feet || values.inches;
        if (
          entered &&
          (!Number.isFinite(heightCm) ||
            (heightUnits === 'ft' && !heightPartsValid()))
        ) {
          event.target.value = heightUnits;
          showErrors({
            [heightUnits === 'cm' ? 'height' : 'feet']:
              'Enter a valid height before converting.',
          });
          return;
        }
        heightUnits = event.target.value;
        if (heightUnits === 'cm') values.height = textNumber(heightCm);
        else {
          const converted = cmToImperial(heightCm);
          const inches = Number(textNumber(converted.inches));
          values.feet = textNumber(converted.feet + (inches === 12 ? 1 : 0));
          values.inches = Number.isFinite(heightCm)
            ? textNumber(inches === 12 ? 0 : converted.inches)
            : '';
        }
        render();
        root.querySelector('#calc-height-units').focus({ preventScroll: true });
      });
    root
      .querySelector('#calc-weight-units')
      .addEventListener('change', (event) => {
        const entered =
          weightUnits === 'st' ? values.stone || values.pounds : values.weight;
        if (
          entered &&
          (!Number.isFinite(weightKg) ||
            (weightUnits === 'st' && !weightPartsValid()))
        ) {
          event.target.value = weightUnits;
          showErrors({
            [weightUnits === 'st' ? 'stone' : 'weight']:
              'Enter a valid weight before converting.',
          });
          return;
        }
        weightUnits = event.target.value;
        if (weightUnits === 'kg') values.weight = textNumber(weightKg);
        else if (weightUnits === 'lb')
          values.weight = textNumber(kgToPounds(weightKg));
        else {
          const converted = kgToStone(weightKg);
          const pounds = Number(textNumber(converted.pounds));
          values.stone = textNumber(converted.stone + (pounds === 14 ? 1 : 0));
          values.pounds = Number.isFinite(weightKg)
            ? textNumber(pounds === 14 ? 0 : converted.pounds)
            : '';
        }
        render();
        root.querySelector('#calc-weight-units').focus({ preventScroll: true });
      });
    root
      .querySelector('#calculator-form')
      .addEventListener('submit', (event) => {
        event.preventDefault();
        const computed = calculate({
          age: calculatorMode === 'bmi' ? 18 : num(values.age),
          sex: calculatorMode === 'bmi' ? 'female' : values.sex,
          heightCm,
          weightKg,
          activity: calculatorMode === 'bmi' ? 'low' : values.activity,
        });
        const errors = Object.fromEntries(
          Object.entries(computed.errors).map(([name, error]) => [
            name === 'heightCm'
              ? heightUnits === 'cm'
                ? 'height'
                : 'feet'
              : name === 'weightKg'
                ? weightUnits === 'st'
                  ? 'stone'
                  : 'weight'
                : name,
            error,
          ])
        );
        if (heightUnits === 'ft') {
          if (!Number.isInteger(num(values.feet)) || num(values.feet) < 0)
            errors.feet = 'Enter whole feet.';
          if (
            !Number.isFinite(num(values.inches)) ||
            num(values.inches) < 0 ||
            num(values.inches) >= 12
          )
            errors.inches = 'Use inches from 0 to under 12.';
        }
        if (weightUnits === 'st') {
          if (!Number.isInteger(num(values.stone)) || num(values.stone) < 0)
            errors.stone = 'Enter whole stone.';
          if (
            !Number.isFinite(num(values.pounds)) ||
            num(values.pounds) < 0 ||
            num(values.pounds) >= 14
          )
            errors.pounds = 'Use pounds from 0 to under 14.';
        }
        if (calculatorMode === 'bmi') {
          delete errors.age;
          delete errors.sex;
          delete errors.activity;
        }
        if (Object.keys(errors).length) {
          showErrors(errors);
          return;
        }
        result = computed;
        go('results');
      });
  }
  function showErrors(errors) {
    root.querySelectorAll('.field-error').forEach((el) => {
      el.hidden = true;
    });
    root
      .querySelectorAll('[data-calc]')
      .forEach((el) => el.removeAttribute('aria-invalid'));
    for (const [name, error] of Object.entries(errors)) {
      const field = root.querySelector('#calc-' + name),
        note = root.querySelector('#error-' + name);
      if (!field || !note) continue;
      field.setAttribute('aria-invalid', 'true');
      note.textContent = error;
      note.hidden = false;
    }
    root.querySelector('[aria-invalid="true"]')?.focus();
  }
  render();
  return {
    setAccess(next) {
      access = next;
      if (view === 'home') render();
      // Update navigation without rebuilding an in-progress form.
      if (view === 'inputs') {
        const existing = root.querySelector(
          '#public-open-dashboard, #calculator-access'
        );
        if (existing) {
          const replacement = document.createElement('button');
          replacement.type = 'button';
          replacement.className = 'secondary';
            replacement.id =
            access === 'authorised'
              ? 'public-open-dashboard'
              : 'calculator-access';
          replacement.textContent =
            access === 'authorised' ? 'Open dashboard' : 'About Check-In Crew';
          replacement.addEventListener(
            'click',
            access === 'authorised' ? openDashboard : () => go('home')
          );
          existing.replaceWith(replacement);
        }
      }
    },
    setOptions(options) {
      enabled = options.calculatorEnabled === true;
      flairEnabled = options.flairEnabled === true;
      if (!flairEnabled && view === 'flair') {
        flairView.cancel();
        view = 'home';
      }
      community = options.community ?? '';
      publicFailed = Boolean(options.failed);
        if (!optionsLoaded && !publicFailed) {
          optionsLoaded = true;
          view = 'home';
      }
      if (!enabled && ['inputs', 'results', 'help'].includes(view))
        view = 'home';
      render();
    },
    setDashboardOpening(opening) {
      dashboardOpening = opening;
      render();
    },
    showHome() {
      dashboardOpening = false;
      flairView.cancel();
      go('home');
    },
  };
}
