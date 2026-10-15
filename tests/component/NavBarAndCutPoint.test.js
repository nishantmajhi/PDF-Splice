import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import NavBar from "@/components/NavBar.vue";
import CutPoint from "@/components/CutPoint.vue";

async function mountNavBarAt(path) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/split", component: { template: "<div/>" } },
      { path: "/merge", component: { template: "<div/>" } },
      { path: "/pdf-to-image", component: { template: "<div/>" } },
      { path: "/extract-images", component: { template: "<div/>" } },
    ],
  });
  router.push(path);
  await router.isReady();
  return mount(NavBar, { global: { plugins: [router] } });
}

describe("NavBar.vue", () => {
  it("renders a link for every tool, plus the brand link", async () => {
    const wrapper = await mountNavBarAt("/");
    const links = wrapper.findAll(".nav-link");
    expect(links.map((l) => l.text())).toEqual([
      "Split",
      "Merge",
      "PDF to Image",
      "Extract Images",
    ]);
  });

  it("marks the current route's link as active", async () => {
    const wrapper = await mountNavBarAt("/merge");
    const merge = wrapper.findAll(".nav-link").find((l) => l.text() === "Merge");
    expect(merge.classes()).toContain("active");
    const split = wrapper.findAll(".nav-link").find((l) => l.text() === "Split");
    expect(split.classes()).not.toContain("active");
  });

  it("no tool link is active on the home route (only the brand link points there)", async () => {
    const wrapper = await mountNavBarAt("/");
    const anyActive = wrapper.findAll(".nav-link").some((l) => l.classes().includes("active"));
    expect(anyActive).toBe(false);
  });

  it("brand link points to home", async () => {
    const wrapper = await mountNavBarAt("/split");
    expect(wrapper.find(".brand").attributes("href")).toBe("/");
  });
});

describe("CutPoint.vue", () => {
  it("shows 'Cut here' label when inactive", () => {
    const wrapper = mount(CutPoint, { props: { active: false } });
    expect(wrapper.attributes("aria-label")).toBe("Cut here");
  });

  it("shows 'Remove cut here' label when active", () => {
    const wrapper = mount(CutPoint, { props: { active: true } });
    expect(wrapper.attributes("aria-label")).toBe("Remove cut here");
  });

  it("applies the active styling class to the scissor icon wrapper when active", () => {
    const wrapper = mount(CutPoint, { props: { active: true } });
    expect(wrapper.find(".gap-scissor").classes()).toContain("gap-plus-active");
  });

  it("does not apply the active class when inactive", () => {
    const wrapper = mount(CutPoint, { props: { active: false } });
    expect(wrapper.find(".gap-scissor").classes()).not.toContain("gap-plus-active");
  });

  it("clicking emits toggle", async () => {
    const wrapper = mount(CutPoint, { props: { active: false } });
    await wrapper.trigger("click");
    expect(wrapper.emitted("toggle")).toBeTruthy();
  });
});
