import { createEvent, createStore } from "effector";

export const heroSectionActivated = createEvent();
export const contentSectionActivated = createEvent();

export const $isHeroSectionActive = createStore(true)
    .on(heroSectionActivated, () => true)
    .on(contentSectionActivated, () => false);
