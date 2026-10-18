// Standalone C++17 teaching model. No ROS dependency or physical-device I/O.
// The pointer-backed command slots illustrate the legacy export style.
#include <iostream>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

struct CommandSlot
{
  double * data;
  void set_value(double value) { *data = value; }
};

using InterfaceMap = std::map<std::string, std::shared_ptr<CommandSlot>>;

struct Motor
{
  std::string joint_name;
  int device_id;
  double target = 0.0;
};

class Hardware
{
public:
  virtual ~Hardware() = default;
  virtual void export_commands(InterfaceMap & interfaces) = 0;
  virtual void write() const = 0;
};

class PositionHardware final : public Hardware
{
public:
  PositionHardware(std::string port, std::vector<Motor> motors)
  : port_(std::move(port)), motors_(std::move(motors)) {}

  PositionHardware(const PositionHardware &) = delete;
  PositionHardware & operator=(const PositionHardware &) = delete;

  void export_commands(InterfaceMap & interfaces) override
  {
    // motors_ is never resized after exporting these addresses.
    for (auto & motor : motors_)
    {
      auto slot = std::make_shared<CommandSlot>(CommandSlot{&motor.target});
      if (!interfaces.emplace(motor.joint_name + "/position", std::move(slot)).second)
      {
        throw std::runtime_error("duplicate command interface");
      }
    }
  }

  void write() const override
  {
    for (const auto & motor : motors_)
    {
      // A real driver would encode the vendor protocol and transmit here.
      std::cout << "SEND port=" << port_ << " device=" << motor.device_id
                << " joint=" << motor.joint_name << " target=" << motor.target << '\n';
    }
  }

private:
  std::string port_;
  std::vector<Motor> motors_;
};

int main()
{
  // Destruction order keeps the command slots shorter-lived than the hardware.
  std::vector<std::unique_ptr<Hardware>> hardware;
  InterfaceMap interfaces;
  hardware.push_back(std::make_unique<PositionHardware>(
    "can0", std::vector<Motor>{{"left_shoulder_joint", 11}, {"left_elbow_joint", 12}}));
  hardware.push_back(std::make_unique<PositionHardware>(
    "/dev/ttyUSB0", std::vector<Motor>{{"gripper_joint", 1}}));

  for (auto & component : hardware)
  {
    component->export_commands(interfaces);
  }

  std::cout << "Controller changes memory only\n";
  interfaces.at("left_elbow_joint/position")->set_value(1.0);
  interfaces.at("gripper_joint/position")->set_value(0.02);

  std::cout << "Manager now calls each hardware object\n";
  for (const auto & component : hardware)
  {
    component->write();
  }
}
