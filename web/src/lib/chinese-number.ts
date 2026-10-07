export function chineseNumber(value: number): string {
    const digits = "零一二三四五六七八九";
    if (value < 10) return digits[value];
    if (value < 100) return `${value < 20 ? "" : digits[Math.floor(value / 10)]}十${value % 10 ? digits[value % 10] : ""}`;
    if (value < 10000) {
        const unit = value < 1000 ? 100 : 1000;
        const rest = value % unit;
        const tail = rest ? `${rest < unit / 10 ? "零" : ""}${rest >= 10 && rest < 20 ? "一" : ""}${chineseNumber(rest)}` : "";
        return `${digits[Math.floor(value / unit)]}${unit === 100 ? "百" : "千"}${tail}`;
    }
    const rest = value % 10000;
    return `${chineseNumber(Math.floor(value / 10000))}万${rest ? `${rest < 1000 ? "零" : ""}${rest >= 10 && rest < 20 ? "一" : ""}${chineseNumber(rest)}` : ""}`;
}
