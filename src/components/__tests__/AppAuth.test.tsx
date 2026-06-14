import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import App from "../../App";
import { supabase } from "../../core/supabaseClient";
import { AuthService } from "../../core/authService";

vi.mock("../../core/supabaseClient", () => {
  const selectMock = vi.fn().mockReturnThis();
  const eqMock = vi.fn().mockReturnThis();
  const orderMock = vi.fn().mockReturnThis();
  const limitMock = vi.fn().mockReturnThis();
  const maybeSingleMock = vi.fn().mockResolvedValue({ data: null });
  
  return {
    supabase: {
      auth: {
        getSession: vi.fn(),
        onAuthStateChange: vi.fn(),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [] }),
            maybeSingle: vi.fn().mockResolvedValue({ data: null })
          })
        })
      }),
    },
    isSupabaseConfigured: true,
  };
});

vi.mock("../../core/authService", () => ({
  AuthService: {
    setUserId: vi.fn(),
    checkAppAdmin: vi.fn(),
    isAppAdmin: vi.fn(),
    getCurrentUserId: vi.fn().mockReturnValue("admin-123"),
  },
}));

vi.mock("../../database/db", () => ({
  Database: {
    init: vi.fn(),
  },
}));

describe("App Authentication Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("usuário sem sessão vê LoginScreen", async () => {
    vi.mocked(supabase!.auth.getSession).mockResolvedValue({ data: { session: null } } as any);
    vi.mocked(supabase!.auth.onAuthStateChange).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    } as any);

    await act(async () => {
      render(<App />);
    });

    expect(screen.getByText(/Entrar no Nihongo Loop/i)).toBeInTheDocument();
  });

  it("usuário comum autenticado vê UnauthorizedScreen e não dispara carregamento de dados", async () => {
    vi.mocked(supabase!.auth.getSession).mockResolvedValue({
      data: { session: { user: { id: "user-123" } } },
    } as any);
    vi.mocked(supabase!.auth.onAuthStateChange).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    } as any);
    vi.mocked(AuthService.checkAppAdmin).mockResolvedValue(false);
    vi.mocked(AuthService.isAppAdmin).mockReturnValue(false);

    await act(async () => {
      render(<App />);
    });

    expect(screen.getByText(/Acesso Restrito/i)).toBeInTheDocument();
    // Verify Database.init is NOT called
    const { Database } = await import("../../database/db");
    expect(Database.init).not.toHaveBeenCalled();
  });

  it("usuário admin autenticado entra no app", async () => {
    vi.mocked(supabase!.auth.getSession).mockResolvedValue({
      data: { session: { user: { id: "admin-123" } } },
    } as any);
    vi.mocked(supabase!.auth.onAuthStateChange).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    } as any);
    vi.mocked(AuthService.checkAppAdmin).mockResolvedValue(true);
    vi.mocked(AuthService.isAppAdmin).mockReturnValue(true);

    await act(async () => {
      render(<App />);
    });

    // Assume the HomeScreen renders something like "Início" or "Fontes" in the nav
    expect(screen.getAllByText(/Início/i).length).toBeGreaterThan(0);
    
    const { Database } = await import("../../database/db");
    expect(Database.init).toHaveBeenCalled();
  });
});
