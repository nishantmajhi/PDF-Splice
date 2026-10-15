import { createRouter, createMemoryHistory } from "vue-router";

// A real router with every app route registered (all NavBar links resolve
// cleanly, no "no match found" warning noise), backed by memory history so
// it works under jsdom without touching the real URL bar.
export function makeTestRouter() {
  const stub = { template: "<div/>" };
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: stub },
      { path: "/split", component: stub },
      { path: "/merge", component: stub },
      { path: "/pdf-to-image", component: stub },
      { path: "/extract-images", component: stub },
    ],
  });
}

// Mounts `component` with a ready test router installed — needed for any
// page component, since they all render <NavBar>, which calls useRoute().
export async function mountWithRouter(component, mountOptions = {}) {
  const router = makeTestRouter();
  router.push("/");
  await router.isReady();
  const { mount } = await import("@vue/test-utils");
  return mount(component, {
    ...mountOptions,
    global: {
      ...mountOptions.global,
      plugins: [router, ...((mountOptions.global && mountOptions.global.plugins) || [])],
    },
  });
}

// Waits for pending microtasks/renders (async file loads, thumbnail
// renders, etc.) to settle.
export async function flush(wrapper) {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();
  }
}
