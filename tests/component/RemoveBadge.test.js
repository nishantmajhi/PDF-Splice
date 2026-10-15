import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import RemoveBadge from "@/components/RemoveBadge.vue";

describe("RemoveBadge.vue", () => {
  it("renders the trash button but no tag when not excluded", () => {
    const wrapper = mount(RemoveBadge, { props: { excluded: false } });
    expect(wrapper.find(".remove-badge-btn").exists()).toBe(true);
    expect(wrapper.find(".remove-badge-btn").classes()).not.toContain("active");
    expect(wrapper.find(".remove-tag").exists()).toBe(false);
  });

  it("shows the active state and the tag when excluded", () => {
    const wrapper = mount(RemoveBadge, { props: { excluded: true, tagText: "Excluded" } });
    expect(wrapper.find(".remove-badge-btn").classes()).toContain("active");
    expect(wrapper.find(".remove-tag").exists()).toBe(true);
    expect(wrapper.find(".remove-tag").text()).toBe("Excluded");
  });

  it("emits 'toggle' when the button is clicked", async () => {
    const wrapper = mount(RemoveBadge, { props: { excluded: false } });
    await wrapper.find(".remove-badge-btn").trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);
  });

  it("stops the click from bubbling up to a parent click handler", async () => {
    const onParentClick = vi.fn();
    const wrapper = mount(
      {
        components: { RemoveBadge },
        template: `<div @click="onParentClick"><RemoveBadge /></div>`,
        setup() {
          return { onParentClick };
        },
      }
    );
    await wrapper.find(".remove-badge-btn").trigger("click");
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it("uses excludeLabel/includeLabel for the aria-label depending on state", async () => {
    const wrapper = mount(RemoveBadge, {
      props: { excluded: false, excludeLabel: "Exclude page 3", includeLabel: "Include page 3" },
    });
    expect(wrapper.find(".remove-badge-btn").attributes("aria-label")).toBe("Exclude page 3");
    await wrapper.setProps({ excluded: true });
    expect(wrapper.find(".remove-badge-btn").attributes("aria-label")).toBe("Include page 3");
  });
});
