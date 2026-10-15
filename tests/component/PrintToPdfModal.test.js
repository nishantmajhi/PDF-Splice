import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import PrintToPdfModal from "@/components/PrintToPdfModal.vue";

describe("PrintToPdfModal", () => {
  it("renders full instructions for a docx file", () => {
    const wrapper = mount(PrintToPdfModal, { props: { filename: "resume.docx" } });
    const steps = wrapper.findAll(".modal-steps > div");
    expect(steps.length).toBeGreaterThan(0);
    expect(wrapper.text()).toContain("Word");
  });

  it("renders full instructions for a .doc file too (previously missing, now fixed)", () => {
    const wrapper = mount(PrintToPdfModal, { props: { filename: "resume.doc" } });
    const steps = wrapper.findAll(".modal-steps > div");
    expect(steps.length).toBeGreaterThan(0);
    expect(wrapper.text()).toContain("Word");
  });

  it("renders full instructions for .ppt and .xls too", () => {
    for (const filename of ["deck.ppt", "sheet.xls"]) {
      const wrapper = mount(PrintToPdfModal, { props: { filename } });
      expect(wrapper.findAll(".modal-steps > div").length).toBeGreaterThan(0);
    }
  });

  it("emits close when the close button is clicked", async () => {
    const wrapper = mount(PrintToPdfModal, { props: { filename: "resume.docx" } });
    await wrapper.find(".modal-close").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("emits close when the overlay (outside the card) is clicked", async () => {
    const wrapper = mount(PrintToPdfModal, { props: { filename: "resume.docx" } });
    await wrapper.find(".modal-overlay").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("does NOT emit close when clicking inside the card itself", async () => {
    const wrapper = mount(PrintToPdfModal, { props: { filename: "resume.docx" } });
    await wrapper.find(".modal-card").trigger("click");
    expect(wrapper.emitted("close")).toBeFalsy();
  });
});
