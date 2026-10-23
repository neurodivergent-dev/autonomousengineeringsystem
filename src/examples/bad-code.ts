// MetaFrame Tarafindan Duzeltilmis Temiz Kod

interface AuthPayload {
  token: string;
}

export function authenticateUser(token: string) {
  // 1. Tip Guvenligi saglandi (any kaldirildi)
  const payload: AuthPayload = { token };

  try {
    if (!token) throw new Error("Token eksik");
    return { status: "OK", payload };
  } catch (err: unknown) {
    // 2. Hata yonetildi (bos catch onlendi)
    const errorMsg = err instanceof Error ? err.message : "Bilinmeyen hata";
    return { status: "ERROR", message: errorMsg };
  }
}
