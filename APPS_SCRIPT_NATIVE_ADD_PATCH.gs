// ============================================================
// HARAZD WAREHOUSE
// NATIVE GITHUB FORM API PATCH
// Add these routes inside doGet(e)
// ============================================================
//
// 1) action=formData
//    Return all dropdown values required by GitHub form.
//
// 2) action=addEquipment
//    Parse params.payload JSON and call the same logic that
//    your existing AddEquipment.html uses to add equipment.
//
// IMPORTANT:
// I need the current 13_AddEquipmentAPI.gs code to wire this
// exactly to your existing addProduct/add-equipment logic without
// duplicating or breaking it.
