/**
 * Reveals the feedback paragraph matching the current selection in a question fieldset.
 * @param {HTMLFieldSetElement} fieldset - The active question fieldset
 */
function showFeedback(fieldset) {
  fieldset.querySelectorAll('.feedback [data-answer]').forEach((f) => {
    f.setAttribute('hidden', '');
  });

  if (fieldset.dataset.step === '3') {
    const anyChecked = fieldset.querySelector('input:checked');
    if (!anyChecked) return;
    const hasMeasuring = fieldset.querySelector('[value="measuring-issues"]').checked;
    const key = hasMeasuring ? 'correct' : 'other';
    const fb = fieldset.querySelector(`[data-answer="${key}"]`);
    if (fb) fb.removeAttribute('hidden');
    return;
  }

  const checked = fieldset.querySelector('input:checked');
  if (!checked) return;
  const feedbackKey = checked.dataset.feedback || checked.value;
  const fb = fieldset.querySelector(`[data-answer="${feedbackKey}"]`);
  if (fb) fb.removeAttribute('hidden');
}

/**
 * Switches to the results stage and reveals the appropriate score and outcome messaging.
 * @param {HTMLElement} widget - The widget root element
 * @param {number} score - Number of correct answers (0–10)
 * @param {boolean} hasIncidents - True if Q1 or Q2 was answered "yes"
 */
function showResults(widget, score, hasIncidents) {
  widget.dataset.stage = 'results';

  const resultsEl = widget.querySelector('.results');
  widget.querySelector('.score').textContent = score;

  resultsEl.querySelectorAll('[data-score]').forEach((el) => el.setAttribute('hidden', ''));
  const scoreKey = score >= 9 ? score : 'low';
  const headlineEl = resultsEl.querySelector(`[data-score="${scoreKey}"]`);
  if (headlineEl) headlineEl.removeAttribute('hidden');

  resultsEl.querySelectorAll('[data-result]').forEach((el) => el.setAttribute('hidden', ''));
  const scoreGroup = score >= 9 ? 'high' : 'low';
  const incidentGroup = hasIncidents ? 'some' : 'none';
  const resultEl = resultsEl.querySelector(`[data-result="${scoreGroup}-${incidentGroup}"]`);
  if (resultEl) resultEl.removeAttribute('hidden');

  const heading = resultsEl.querySelector('h2');
  if (heading) heading.focus();
}

/**
 * Tallies correct answers and incident flags, then delegates to showResults.
 * @param {HTMLElement} widget - The widget root element
 */
function scoreQuiz(widget) {
  const tally = widget.querySelectorAll('input[data-correct="true"]:checked').length;
  const q1Yes = widget.querySelector('input[name="q1"][value="yes"]').checked;
  const q2Yes = widget.querySelector('input[name="q2"][value="yes"]').checked;
  showResults(widget, tally, q1Yes || q2Yes);
}

export default function decorate(widget) {
  const progressEl = widget.querySelector('progress');
  const stepLabelEl = widget.querySelector('.step-label');
  const questions = widget.querySelectorAll('fieldset[data-step]');
  const prevBtn = widget.querySelector('.prev');
  const nextBtn = widget.querySelector('.next');

  let currentStep = 0;

  const updateNext = (fieldset) => {
    nextBtn.disabled = !fieldset.querySelector('input:checked');
  };

  const showStep = (step) => {
    questions.forEach((q) => q.setAttribute('hidden', ''));

    const question = widget.querySelector(`fieldset[data-step="${step}"]`);
    question.removeAttribute('hidden');
    question.focus();

    progressEl.value = step;
    stepLabelEl.textContent = step;

    prevBtn[step > 1 ? 'removeAttribute' : 'setAttribute']('hidden', '');

    updateNext(question);
    showFeedback(question);
  };

  const retake = () => {
    widget.querySelectorAll('input').forEach((input) => {
      input.checked = false;
    });
    progressEl.value = 0;
    currentStep = 0;
    widget.dataset.stage = 'intro';
  };

  widget.dataset.stage = 'intro';

  widget.querySelector('.footer [data-stage="intro"] button').addEventListener('click', () => {
    widget.dataset.stage = 'quiz';
    currentStep = 1;
    showStep(1);
  });

  nextBtn.addEventListener('click', () => {
    if (currentStep === 10) { scoreQuiz(widget); return; }
    showStep(currentStep += 1);
  });

  prevBtn.addEventListener('click', () => {
    showStep(currentStep -= 1);
  });

  widget.querySelector('button[type="reset"]').addEventListener('click', retake);

  widget.addEventListener('change', (e) => {
    const question = e.target.closest('fieldset');
    if (!question) return;
    showFeedback(question);
    updateNext(question);
  });
}
