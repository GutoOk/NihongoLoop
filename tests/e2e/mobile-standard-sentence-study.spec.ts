import { test, expect } from '@playwright/test';

test.describe('Mobile Standard Study Flow', () => {
  test.use({ viewport: { width: 375, height: 667 } }); // Mobile viewport

  test.beforeEach(async ({ page }) => {
    // Pipe page console to node terminal for debugging
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    // Inject the E2E bypass flag securely for the test environment before the page loads
    await page.addInitScript(() => {
      window.localStorage.setItem("VITE_E2E_AUTH_BYPASS", "true");
      window.localStorage.setItem("VITE_E2E_DATA_MOCK", "true");
      (window as any).__E2E_TEST_BYPASS__ = true;
      (window as any).__E2E_DATA_MOCK__ = true;
    });
  });

  test('Deve abrir a tela de quiz após o estudo padrão de frases', async ({ page }) => {
    // Navigate to app
    await page.goto('/');
    
    // Click to render study sources setup
    await page.getByRole('button', { name: /Estudar Sessões de repetição/i }).click();
    await expect(page.locator('select').first()).toBeVisible();

    // Select the "Fonte de Teste E2E" source option in the dropdown list
    await page.locator('select').first().selectOption({ label: 'Fonte de Teste E2E' });

    // Click to launch the standard study session player
    await page.getByRole('button', { name: /Frases \(Pt→Jp\)/i }).click();

    // Verify player is visible
    await expect(page.getByText(/Frases|Japonês/i).first()).toBeVisible({ timeout: 5000 });

    // Loop through cards until we reach the end
    let hasReachedEnd = false;
    for (let i = 0; i < 20; i++) {
       const btnAvancar = page.locator('#study-btn-advance-quiz');
       if (await btnAvancar.isVisible()) {
          hasReachedEnd = true;
          await btnAvancar.click();
          break;
       }
       
       const btnNext = page.locator('#study-btn-next');
       if (await btnNext.isVisible() && !(await btnNext.isDisabled())) {
          await btnNext.click();
       }
       await page.waitForTimeout(400);
    }

    // Force failure if we couldn't proceed to quiz
    expect(hasReachedEnd).toBe(true);

    // Must not be stuck in "Preparando Quiz"
    await expect(page.getByText(/Preparando Quiz/i)).not.toBeVisible({
      timeout: 10000,
    });

    // Quiz screen should be visible
    await expect(
      page.getByText(/Iniciar Quiz|Qual é|Significado/i).first()
    ).toBeVisible({ timeout: 5000 });
  });
});
