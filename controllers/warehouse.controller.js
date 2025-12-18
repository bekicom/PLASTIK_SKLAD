const Warehouse = require("../modules/Warehouse/Warehouse");

const ALLOWED = ["UZS", "USD"];

/**
 * POST /api/warehouses
 */
exports.createWarehouse = async (req, res) => {
  try {
    const { name, currency } = req.body;

    if (!name || !currency) {
      return res.status(400).json({
        ok: false,
        message: "name va currency majburiy",
      });
    }

    if (!ALLOWED.includes(currency)) {
      return res.status(400).json({
        ok: false,
        message: "currency noto‘g‘ri (UZS/USD)",
      });
    }

    const exists = await Warehouse.findOne({ currency });
    if (exists) {
      return res.status(409).json({
        ok: false,
        message: `${currency} ombor allaqachon mavjud`,
      });
    }

    const wh = await Warehouse.create({ name, currency });

    return res.status(201).json({
      ok: true,
      message: "Warehouse yaratildi",
      warehouse: wh,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};

/**
 * GET /api/warehouses
 */
exports.getWarehouses = async (req, res) => {
  try {
    const items = await Warehouse.find().sort({ createdAt: -1 });

    return res.json({
      ok: true,
      items,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};

/**
 * GET /api/warehouses/:id
 */
exports.getWarehouseById = async (req, res) => {
  try {
    const wh = await Warehouse.findById(req.params.id);

    if (!wh) {
      return res.status(404).json({
        ok: false,
        message: "Warehouse topilmadi",
      });
    }

    return res.json({
      ok: true,
      warehouse: wh,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};

/**
 * PUT /api/warehouses/:id
 * (faqat name ni update qilamiz, currency o'zgarmaydi)
 */
exports.updateWarehouse = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({
        ok: false,
        message: "name majburiy",
      });
    }

    const wh = await Warehouse.findById(req.params.id);
    if (!wh) {
      return res.status(404).json({
        ok: false,
        message: "Warehouse topilmadi",
      });
    }

    wh.name = name;
    await wh.save();

    return res.json({
      ok: true,
      message: "Warehouse yangilandi",
      warehouse: wh,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};

/**
 * DELETE /api/warehouses/:id
 */
exports.deleteWarehouse = async (req, res) => {
  try {
    const wh = await Warehouse.findByIdAndDelete(req.params.id);

    if (!wh) {
      return res.status(404).json({
        ok: false,
        message: "Warehouse topilmadi",
      });
    }

    return res.json({
      ok: true,
      message: "Warehouse o‘chirildi",
      warehouse: wh,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Server xatoligi",
      error: error.message,
    });
  }
};
