import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import UploadShell from "@/components/UploadShell.vue";

function setInputFiles(input, files) {
  Object.defineProperty(input, "files", { value: files, configurable: true });
}

describe("UploadShell.vue", () => {
  it("renders default title/subtitle when none given", () => {
    const wrapper = mount(UploadShell);
    expect(wrapper.find("h2").text()).toBe("Drop a PDF to get started");
  });

  it("renders custom title/subtitle when provided", () => {
    const wrapper = mount(UploadShell, {
      props: { title: "Drop a PDF to split", subtitle: "Click a gap to cut." },
    });
    expect(wrapper.find("h2").text()).toBe("Drop a PDF to split");
    expect(wrapper.find("p").text()).toBe("Click a gap to cut.");
  });

  it("browse link says 'a file' in single mode and 'files' in multiple mode", () => {
    const single = mount(UploadShell, { props: { multiple: false } });
    expect(single.find(".browse-link").text()).toContain("a file");

    const multi = mount(UploadShell, { props: { multiple: true } });
    expect(multi.find(".browse-link").text()).toContain("files");
  });

  it("single-file mode: selecting one file emits file-chosen once with that file", async () => {
    const wrapper = mount(UploadShell, { props: { multiple: false } });
    const input = wrapper.find('input[type="file"]');
    const file = new File(["x"], "a.pdf");
    setInputFiles(input.element, [file]);
    await input.trigger("change");
    expect(wrapper.emitted("file-chosen")).toEqual([[file]]);
  });

  it("BUG: single-file mode silently drops every file after the first if multiple are selected/dropped", async () => {
    // UploadShell.vue's handleFiles(): `else if (files[0]) emit(...)` only
    // ever emits the first file in non-multiple mode. If the underlying
    // <input> or a drag-drop event somehow delivers more than one file
    // (e.g. the OS file picker allows multi-select despite `multiple`
    // being unset, or a user drags multiple files onto a single-file
    // dropzone), everything after the first is silently discarded with no
    // warning to the user.
    const wrapper = mount(UploadShell, { props: { multiple: false } });
    const input = wrapper.find('input[type="file"]');
    const fileA = new File(["x"], "a.pdf");
    const fileB = new File(["y"], "b.pdf");
    setInputFiles(input.element, [fileA, fileB]);
    await input.trigger("change");
    expect(wrapper.emitted("file-chosen").length).toBe(1);
    expect(wrapper.emitted("file-chosen")[0]).toEqual([fileA]);
  });

  it("multiple mode: selecting several files emits file-chosen once per file, in order", async () => {
    const wrapper = mount(UploadShell, { props: { multiple: true } });
    const input = wrapper.find('input[type="file"]');
    const fileA = new File(["x"], "a.pdf");
    const fileB = new File(["y"], "b.pdf");
    setInputFiles(input.element, [fileA, fileB]);
    await input.trigger("change");
    expect(wrapper.emitted("file-chosen")).toEqual([[fileA], [fileB]]);
  });

  it("selecting zero files emits nothing", async () => {
    const wrapper = mount(UploadShell, { props: { multiple: true } });
    const input = wrapper.find('input[type="file"]');
    setInputFiles(input.element, []);
    await input.trigger("change");
    expect(wrapper.emitted("file-chosen")).toBeFalsy();
  });

  it("dragover sets the dragover class; dragleave clears it", async () => {
    const wrapper = mount(UploadShell);
    const card = wrapper.find(".upload-card");
    await card.trigger("dragover");
    expect(card.classes()).toContain("dragover");
    await card.trigger("dragleave");
    expect(card.classes()).not.toContain("dragover");
  });

  it("dropping a file emits file-chosen and clears the dragover state", async () => {
    const wrapper = mount(UploadShell, { props: { multiple: false } });
    const card = wrapper.find(".upload-card");
    const file = new File(["x"], "dropped.pdf");
    await card.trigger("dragover");
    await card.trigger("drop", { dataTransfer: { files: [file] } });
    expect(wrapper.emitted("file-chosen")).toEqual([[file]]);
    expect(card.classes()).not.toContain("dragover");
  });

  it("the file input's accept attribute reflects the accept prop", () => {
    const wrapper = mount(UploadShell, { props: { accept: "image/*" } });
    expect(wrapper.find('input[type="file"]').attributes("accept")).toBe("image/*");
  });
});
