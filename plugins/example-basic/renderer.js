window.__bdgPluginRegister(function activate(api) {
  api.log("renderer entry activated (id=" + api.id + ")");
  return function dispose() {
    api.log("renderer entry disposed");
  };
});
