import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "EggShip Admin",
  version: packageJson.version,
  copyright: `© ${currentYear}, EggShip.`,
  meta: {
    title: "EggShip Admin",
    description: "پنل مدیریت عمده‌فروشی تخم‌مرغ EggShip",
  },
};
