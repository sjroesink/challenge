const START_DATE = '2026-04-01';

function getCurrentDay(now = new Date()) {
  // Get the date in Amsterdam timezone
  const amsterdamDate = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
  const startDate = new Date(`${START_DATE}T00:00:00`);

  // Calculate Amsterdam-local start of day for both
  const startDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const currentDay = new Date(amsterdamDate.getFullYear(), amsterdamDate.getMonth(), amsterdamDate.getDate());

  const diffMs = currentDay - startDay;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  return diffDays + 1;
}

export { getCurrentDay, START_DATE };
