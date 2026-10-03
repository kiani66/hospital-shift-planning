import { describe, expect, it } from "vitest";

import { authorityConfirmation } from "./authority-presentation";

describe("authority confirmations", () => {
  it("warns on self-demotion and explains the next navigation and remaining-admin requirement", () => {
    const copy = authorityConfirmation({
      isHospitalAdmin: true,
      isActive: true,
      self: true,
    });
    expect(copy.removing).toBe(true);
    expect(copy.warning).toBe(true);
    expect(copy.description).toContain(
      "کنترل‌های مدیریت بیمارستان دیگر در دسترس",
    );
    expect(copy.description).toContain("مدیر فعال دیگری");
  });
  it("confirms another user's removal without a self-demotion warning", () => {
    const copy = authorityConfirmation({
      isHospitalAdmin: true,
      isActive: true,
      self: false,
    });
    expect(copy.warning).toBe(false);
    expect(copy.description).toContain("آخرین مدیر فعال");
    expect(copy.description).toContain("تغییر نمی‌کنند");
  });
  it("explains stored inactive authority and separate explicit reactivation", () => {
    const copy = authorityConfirmation({
      isHospitalAdmin: false,
      isActive: false,
      self: false,
    });
    expect(copy.removing).toBe(false);
    expect(copy.description).toContain("تا فعال‌سازی صریح حساب");
    expect(copy.description).toContain("حساب را فعال نمی‌کند");
  });
  it("does not describe admin authority as department or schedule privilege", () => {
    const copy = authorityConfirmation({
      isHospitalAdmin: false,
      isActive: true,
      self: false,
    });
    expect(copy.description).toContain("مستقل از عضویت بخش");
    expect(copy.description).toContain("به‌تنهایی نمی‌دهد");
    expect(copy.warning).toBe(false);
  });
});
